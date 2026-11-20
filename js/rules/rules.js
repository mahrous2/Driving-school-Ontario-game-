/* Rule engine: tracks where the student driver is (road, lane, approach, intersection) and
 * evaluates Ontario rules every frame, flagging violations to the examiner.
 */
(function () {
  'use strict';
  const DS = window.DS, U = DS.U, C = DS.C;

  const R = {
    init(G) {
      this.G = G;
      this.st = {
        lane: null, approach: null, entry: null, prevNode: null,
        speedT: 0, speedTier: 0, winterT: 0, slowT: 0, lightsT: 0, followT: 0, tailT: 0,
        bikeT: 0, wrongT: 0, leftT: 0, keepRightT: 0, ringRevT: 0,
        lastManeuver: -99, sigMoveT: 0, sigRef: -1, sigManRef: -99,
        pulledOut: !G.scenario.startParked, startPos: { x: G.player.x, y: G.player.y },
        busFlag: new Set(), scFlag: new Set(), ev: new Map(), passedPolice: new Set(),
        lastRight: -99, collideCool: new Map(), prevRingAng: null,
        exitSlowDone: false, rightSignalT: -99,
      };
      G.playerLoc = { road: null, dir: 1, s: 0, u: 0, laneInfo: null, approach: null, nodeEntry: null, inNode: false, limit: null, gapInfo: null, blind: { L: false, R: false } };
    },

    flag(code, opts) { return this.G.examiner.flag(code, opts); },

    update(dt) {
      const G = this.G, P = G.player, net = G.net, st = this.st;
      if (G.finished) return;
      const loc = net.locate(P.x, P.y);
      const pl = G.playerLoc;
      pl.loc = loc;
      pl.inNode = !!loc.node;
      pl.road = loc.road; pl.s = loc.s; pl.u = loc.u; pl.ramp = loc.ramp; pl.rampS = loc.rampS;
      // travel direction on road
      if (loc.road) {
        const hd = loc.road.heading(1);
        const c = Math.cos(P.h - hd);
        pl.dir = c >= 0 ? 1 : -1;
        pl.aligned = Math.abs(c) > 0.8;
        pl.laneInfo = loc.surface === 'road' || loc.surface === 'median' ? loc.road.classify(pl.dir, loc.u, loc.s) : null;
      } else { pl.laneInfo = null; pl.aligned = false; }
      if (P.signalDir() > 0) st.rightSignalT = G.time;

      // speed limit
      if (loc.road && !loc.node) pl.limit = net.speedLimit(loc.road, pl.dir, loc.s, G.schoolActive);
      else if (loc.ramp) pl.limit = loc.ramp.limit;
      pl.schoolZone = loc.road && G.schoolActive ? net.inSchoolZone(loc.road, loc.s) : null;

      this.trackApproach(dt, loc);
      this.trackNode(dt, loc);
      this.trackLane(dt, loc);
      this.gapAndBlindSpots(dt);
      this.checkGeneral(dt, loc);
      this.checkSpecial(dt, loc);
      this.checkCollisions(dt);
      for (const ev of G.events) if (ev.type === 'cutoff') this.flag('CUT_OFF', { cooldown: 10 });
      G.events.length = 0;
    },

    // ---------- approach to an intersection ----------
    trackApproach(dt, loc) {
      const G = this.G, P = G.player, net = G.net, st = this.st, pl = G.playerLoc;
      let ap = null;
      if (loc.road && !loc.node && pl.aligned && (!pl.laneInfo || pl.laneInfo.kind !== 'wrongway') && loc.surface !== 'sidewalk') {
        const r = loc.road, dir = pl.dir;
        const sFront = loc.s + dir * P.len / 2;
        const node = dir > 0 ? r.nodes.find((n) => net.nodeS(n, r) > loc.s) : [...r.nodes].reverse().find((n) => net.nodeS(n, r) < loc.s);
        if (node) {
          const arm = net.armOf(node, r, -dir);
          if (arm) {
            const distEdge = (net.edgeS(node, r, -dir, loc.u) - sFront) * dir;
            const stopDist = node.crosswalk ? C.CW_W + C.STOP_GAP : node.ring ? 0.8 : 1.0;
            const sig = P.signalDir();
            ap = { node, k: arm.k, road: r, dir, distEdge, distStop: distEdge - stopDist, intent: sig < 0 ? 'L' : sig > 0 ? 'R' : 'S' };
          }
        }
      }
      const prev = st.approach;
      if (ap && prev && prev.node === ap.node && prev.k === ap.k) {
        Object.assign(prev, { distEdge: ap.distEdge, distStop: ap.distStop, intent: ap.intent });
        ap = prev;
      } else if (ap) {
        ap.minV = 99; ap.firstStop = null; ap.stopDur = 0; ap.maxStopRed = 0; ap.lightPrev = null; ap.amber = null;
        ap.crossed = false; ap.lightAtLine = null; ap.hesFlag = false; ap.queued = false;
        if (prev && prev.queued) prev.node.queue.delete('player');
      } else if (prev && !loc.node) {
        if (prev.queued) prev.node.queue.delete('player');
      }
      if (ap && !loc.node) {
        const node = ap.node;
        const inZone = ap.distStop < 30 && ap.distStop > -C.CW_W - 1;
        if (inZone) {
          ap.minV = Math.min(ap.minV, P.speed);
          if (P.speed < 0.15) {
            ap.stopDur += dt;
            if (!ap.firstStop) ap.firstStop = { distStop: ap.distStop, t: G.time };
            if (node.control === 'signal' && net.light(node, ap.k) === 'R') ap.maxStopRed = Math.max(ap.maxStopRed, ap.stopDur);
            // register at the all-way / two-way stop queue
            const leadGap = pl.gapInfo ? pl.gapInfo.gap : 99;
            if (node.stopArms.has(ap.k) && !ap.queued && ap.distStop < 3 && leadGap > ap.distStop + 2) {
              node.queue.set('player', { t: G.time, arm: ap.k, ent: P });
              ap.queued = true; ap.queueT = G.time;
            }
          } else ap.stopDur = 0;
        }
        // signals: amber onset & stop-line crossing
        if (node.control === 'signal') {
          const light = net.light(node, ap.k);
          if (ap.lightPrev === 'G' && light === 'Y' && ap.distStop > 0) ap.amber = { d: ap.distStop, v: P.speed };
          ap.lightPrev = light;
          if (!ap.crossed && ap.distStop <= 0 && ap.distStop > -2 && P.v > 0.3) {
            ap.crossed = true; ap.lightAtLine = light; ap.vAtLine = P.speed;
          }
        }
        // hesitation at all-way stops
        if (node.control === 'stop4' && ap.queued && !ap.hesFlag && P.speed < 0.15 && ap.distStop < 3) {
          const me = node.queue.get('player');
          const pedsBusy = G.peds.list.some((p) => p.onRoad && Math.hypot(p.x - node.x, p.y - node.y) < 28);
          // a driver may reasonably wait while another vehicle is still rolling up to the intersection
          const arriving = G.traffic.vehicles.some((o) => o.kind === 'veh' && o.v > 1 && o.seg && !o.seg.conn && o.seg.toNode === node && o.seg.len - o.s < 35);
          if (me && G.time - me.t > 9 && this.allWayHasPriority(node, me) && !this.nodeBusy(node) && !pedsBusy && !arriving) {
            ap.hesFlag = true; this.flag('HESITATION', { cooldown: 30 });
          }
        }
      }
      st.approach = ap && !loc.node ? ap : loc.node ? st.approach : null;
      pl.approach = st.approach && !loc.node ? st.approach : null;
    },

    allWayHasPriority(node, me) {
      for (const [id, e] of node.queue) {
        if (id === 'player') continue;
        if (e.t < me.t - 0.6) return false;
        if (Math.abs(e.t - me.t) <= 0.6 && e.arm === (me.arm + 3) % 4) return false;
      }
      return true;
    },
    nodeBusy(node) {
      for (const o of this.G.traffic.vehicles) {
        if (o.kind !== 'veh') continue;
        if (node.ring ? Math.hypot(o.x - node.x, o.y - node.y) < node.ring.r1 : U.pointInRect(o, node.box)) return true;
      }
      return false;
    },

    // ---------- intersection entry / exit ----------
    trackNode(dt, loc) {
      const G = this.G, P = G.player, net = G.net, st = this.st, pl = G.playerLoc;
      const node = loc.node;
      if (node && (!st.entry || st.entry.node !== node)) {
        if (st.entry) this.onNodeExit(st.entry, null);
        // entering
        const ap = st.approach && st.approach.node === node ? st.approach : null;
        const k = ap ? ap.k : net.armAt(node, P.x - Math.cos(P.h) * 4, P.y - Math.sin(P.h) * 4);
        const inH = Math.atan2(-DS.ARM_VEC[k].y, -DS.ARM_VEC[k].x);
        st.entry = { node, k, t: G.time, sig: P.signalDir(), sigSince: P.sigOnSince, ap, inH, light: node.sig ? net.light(node, k) : null, leftFlag: false, redFlag: false, lastShoulderR: P.lastShoulderR, ringAngs: [] };
        pl.nodeEntry = st.entry;
        this.onNodeEnter(st.entry);
      } else if (!node && st.entry) {
        const e = st.entry;
        const kOut = net.armAt(e.node, P.x, P.y);
        st.entry = null; pl.nodeEntry = null;
        this.onNodeExit(e, kOut);
      } else if (node && st.entry) {
        this.whileInNode(dt, st.entry);
      }
    },

    onNodeEnter(e) {
      const G = this.G, P = G.player, net = G.net, node = e.node, ap = e.ap;
      if (P.v < -0.2) return; // reversing through: ignore
      // ---- stop signs ----
      if (node.stopArms.has(e.k) && (node.control === 'stop4' || node.control === 'stop2')) {
        if (!ap || ap.minV > 2.2) this.flag('STOP_NONE', { key: 'stop' + node.id, cooldown: 20, detail: 'At ' + node.name + '.' });
        else if (ap.minV > 0.4) this.flag('STOP_ROLLING', { key: 'stop' + node.id, cooldown: 20, detail: 'Lowest speed: ' + Math.round(ap.minV * 3.6) + ' km/h.' });
        else {
          if (ap.firstStop && ap.firstStop.distStop < -1.5) this.flag('STOP_PAST_LINE', { cooldown: 20 });
          else this.G.examiner.praise('Good complete stop at the stop sign.', 'stop');
        }
        if (node.control === 'stop4') {
          const me = node.queue.get('player') || { t: G.time, arm: e.k };
          if (!this.allWayHasPriority(node, me)) this.flag('ALLWAY_YIELD', { key: 'ay' + node.id, cooldown: 20, detail: 'Another driver stopped before you (or at the same time on your right).' });
        } else {
          // two-way stop: yield to through traffic
          for (const o of G.traffic.vehicles) {
            if (o.kind !== 'veh' || !o.seg || o.seg.conn || o.seg.toNode !== node || !o.seg.toArm) continue;
            if (node.stopArms.has(o.seg.toArm.k)) continue;
            const d = o.seg.len - o.s - o.len / 2;
            if (d < 45 && o.v > 2 && d / o.v < 3.2) { this.flag('STOP_YIELD', { key: 'sy' + node.id, cooldown: 15 }); break; }
          }
        }
      }
      // ---- roundabout yield ----
      if (node.ring) {
        const aE = Math.atan2(P.y - node.y, P.x - node.x);
        for (const o of G.traffic.vehicles) {
          if (o.kind !== 'veh' || !o.seg || !o.seg.conn || o.seg.node !== node) continue;
          if (o.seg.armOut === e.k && o.s > o.seg.len - 12) continue;
          if (o.seg.armIn === e.k && o.s < 8) continue;
          const a = Math.atan2(o.y - node.y, o.x - node.x);
          const delta = U.angNorm(aE - a);
          if (delta > -0.1 && delta < 1.2 && o.v > 1.5) { this.flag('ROUNDABOUT_YIELD', { key: 'ry' + node.id, cooldown: 15 }); break; }
        }
        this.st.prevRingAng = aE;
      }
      // ---- cyclists for right turns ----
      e.bikeNear = false;
      if (ap && ap.road.bike) {
        for (const b of G.traffic.vehicles) {
          if (b.kind !== 'bike' || b.seg.conn || b.seg.road !== ap.road || b.seg.dir !== ap.dir) continue;
          const rel = U.toLocal(b.x, b.y, P.x, P.y, P.h);
          if (rel.f > -14 && rel.f < 2.5 && rel.r > 0) e.bikeNear = true;
        }
      }
      // ---- right turn on red: conflicts ----
      if (node.sig && e.light === 'R' && e.sig > 0) {
        const kl = (e.k + 1) % 4;
        for (const o of G.traffic.vehicles) {
          if (o.kind !== 'veh' || !o.seg || o.seg.conn || o.seg.toNode !== node || !o.seg.toArm || o.seg.toArm.k !== kl) continue;
          const d = o.seg.len - o.s - o.len / 2;
          if (o.v > 2 && d / o.v < 4) e.rtorConflict = true;
        }
      }
    },

    whileInNode(dt, e) {
      const G = this.G, P = G.player, net = G.net, node = e.node;
      const turned = U.angDiff(P.h, e.inH);
      // ---- red light running (going straight / left) ----
      if (node.sig && e.ap && e.ap.lightAtLine === 'R' && !e.redFlag) {
        const rel = U.toLocal(P.x, P.y, node.x, node.y, e.inH);
        if (rel.f > -1 && turned > -0.5) { e.redFlag = true; this.flag('RED_LIGHT', { key: 'red' + node.id, cooldown: 30, detail: 'At ' + node.name + '.' }); }
      }
      // ---- left turn across oncoming traffic ----
      if (!node.ring && !e.leftFlag && turned > 0.3) {
        const rel = U.toLocal(P.x, P.y, node.x, node.y, e.inH);
        if (rel.r < -0.5) {
          const ko = (e.k + 2) % 4;
          let conflict = false, severe = false;
          for (const o of G.traffic.vehicles) {
            if (o.kind === 'bike' || o.v < 2) continue;
            if (o.seg && !o.seg.conn && o.seg.toNode === node && o.seg.toArm && o.seg.toArm.k === ko && (!o.plan || o.plan.move !== 'L')) {
              const d = o.seg.len - o.s - o.len / 2;
              const ttc = d / o.v;
              if (ttc < 2.8 && d < 50) { conflict = true; if (ttc < 1.6) severe = true; }
            }
            if (o.seg && o.seg.conn && o.seg.node === node && o.seg.armIn === ko && o.seg.move !== 'L') conflict = true;
          }
          if (conflict) { e.leftFlag = true; this.flag('LEFT_YIELD', { key: 'ly' + node.id, cooldown: 20, detail: severe ? 'The oncoming vehicle was less than 2 seconds away.' : '' }); }
        }
      }
      // ---- roundabout direction & speed ----
      if (node.ring) {
        const a = Math.atan2(P.y - node.y, P.x - node.x);
        if (this.st.prevRingAng !== null && P.speed > 1) {
          const da = U.angNorm(a - this.st.prevRingAng);
          if (da < -0.002) this.st.ringRevT += dt; else this.st.ringRevT = Math.max(0, this.st.ringRevT - dt);
          if (this.st.ringRevT > 0.8) { this.flag('ROUNDABOUT_WRONG', { key: 'rw' + node.id, cooldown: 30 }); this.st.ringRevT = 0; }
        }
        this.st.prevRingAng = a;
        if (P.kmh > 40) this.flag('ROUNDABOUT_SPEED', { cooldown: 25 });
      }
    },

    onNodeExit(e, kOut) {
      const G = this.G, P = G.player, net = G.net, node = e.node;
      node.queue.delete('player');
      this.st.approach = null;
      if (kOut === null || kOut === undefined) return;
      const move = DS.relation(e.k, kOut);
      if (P.v < -0.2) return;
      if (node.ring) {
        // signal right when exiting
        if (G.time - this.st.rightSignalT > 2.5) this.flag('ROUNDABOUT_SIGNAL', { cooldown: 15 });
        else G.examiner.praise('Nice — you signalled right to leave the roundabout.', 'rbsig');
        this.st.lastManeuver = G.time;
        return;
      }
      if (move === 'L' || move === 'R') {
        this.st.lastManeuver = G.time;
        const want = move === 'L' ? -1 : 1;
        if (e.sig === 0) this.flag('SIGNAL_TURN', { cooldown: 10, detail: move === 'L' ? 'Left turn.' : 'Right turn.' });
        else if (e.sig !== want) this.flag('SIGNAL_WRONG', { cooldown: 10 });
      }
      // ---- right turn on red ----
      if (node.sig && e.ap && e.ap.lightAtLine === 'R' && !e.redFlag) {
        if (move === 'R') {
          const ap = e.ap;
          if (node.rtorBan.has(e.k)) this.flag('RTOR_BANNED', { key: 'rtor' + node.id, cooldown: 30 });
          else if (ap.maxStopRed < 0.05) this.flag('RTOR_NOSTOP', { key: 'rtor' + node.id, cooldown: 30 });
          else if (ap.maxStopRed < 3) this.flag('RTOR_SHORT', { key: 'rtor' + node.id, cooldown: 30, detail: 'You stopped for ' + ap.maxStopRed.toFixed(1) + ' s.' });
          else G.examiner.praise('Good right turn on red: full stop, then yield.', 'rtor');
          if (e.rtorConflict) this.flag('RTOR_YIELD', { cooldown: 20 });
        } else this.flag('RED_LIGHT', { key: 'red' + node.id, cooldown: 30, detail: 'At ' + node.name + '.' });
      } else if (node.sig && e.ap && e.ap.lightAtLine === 'Y' && e.ap.amber) {
        const a = e.ap.amber;
        if (a.d > a.v * 1.0 + (a.v * a.v) / (2 * 3.6) + 4) this.flag('AMBER', { cooldown: 20 });
      }
      // ---- cyclists ----
      if (move === 'R' && e.ap && e.ap.road.bike) {
        if (G.time - P.lastShoulderR > 6 && G.time - e.lastShoulderR > 6) this.flag('BIKE_SHOULDER', { cooldown: 15 });
        if (e.bikeNear) this.flag('BIKE_YIELD', { cooldown: 15 });
      }
    },

    // ---------- lanes, lane changes and merges ----------
    trackLane(dt, loc) {
      const G = this.G, P = G.player, st = this.st, pl = G.playerLoc;
      const li = pl.laneInfo;
      if (loc.node || !loc.road || !pl.aligned || !li) { if (loc.node) st.lane = null; return; }
      const idx = li.kind === 'lane' || li.kind === 'aux' ? li.lane : null;
      if (idx === null) return;
      const cur = { road: loc.road, dir: pl.dir, idx, kind: li.kind, aux: li.aux || null, s: loc.s };
      const prev = st.lane;
      st.lane = cur;
      if (!prev || prev.road !== cur.road || prev.dir !== cur.dir || prev.idx === cur.idx) return;
      if (Math.abs(prev.idx - cur.idx) !== 1 || P.speed < 1.5) return;
      const toRight = cur.idx > prev.idx;
      const merging = prev.kind === 'aux' && prev.aux && prev.aux.kind === 'accel';
      const exiting = cur.kind === 'aux' && cur.aux && cur.aux.kind === 'decel';
      st.lastManeuver = G.time;
      st.laneChangeT = G.time;
      // signal
      const want = toRight ? 1 : -1;
      const sigOk = P.signalDir() === want && P.sigOnSince > 0 && G.time - P.sigOnSince > 0.7;
      if (!sigOk) this.flag(merging ? 'MERGE_SIGNAL' : 'SIGNAL_LANE', { cooldown: 6 });
      // mirrors & shoulder check
      if (G.time - P.lastMirror > 7) this.flag('MIRROR_LANE', { cooldown: 6 });
      const sh = toRight ? P.lastShoulderR : P.lastShoulderL;
      if (G.time - sh > 5) this.flag(merging ? 'MERGE_SHOULDER' : 'SHOULDER_LANE', { cooldown: 6 });
      else if (merging) G.examiner.praise('Good shoulder check before merging.', 'mergesc');
      // merge speed and gore
      if (merging) {
        if (P.kmh < 75) this.flag('MERGE_SLOW', { cooldown: 20, detail: 'Merge speed: ' + Math.round(P.kmh) + ' km/h.' });
        if (prev.aux.solidEnd && loc.s * prev.aux.dir < prev.aux.solidEnd * prev.aux.dir) this.flag('GORE', { cooldown: 20 });
      }
      if (exiting && cur.aux.solidStart && loc.s * cur.aux.dir > cur.aux.solidStart * cur.aux.dir) this.flag('GORE', { cooldown: 20 });
      // gap check in the target lane
      for (const o of G.traffic.vehicles) {
        if (o.kind === 'bike') continue;
        const rel = U.toLocal(o.x, o.y, P.x, P.y, P.h);
        const inTarget = o.seg && !o.seg.conn && o.seg.road === loc.road && o.seg.dir === pl.dir ? o.seg.lane === cur.idx : Math.abs(rel.r) < 1.9;
        if (!inTarget || Math.abs(rel.r) > 4) continue;
        const g = Math.abs(rel.f) - P.len / 2 - o.len / 2;
        const closing = rel.f < 0 ? o.v - P.speed : P.speed - o.v;
        if ((rel.f >= 0 && g < Math.max(3, P.speed * 0.35)) || (rel.f < 0 && (g < 4 || (closing > 0 && g / closing < 1.6)))) {
          this.flag('UNSAFE_LANE', { cooldown: 8 }); break;
        }
      }
    },

    // ---------- following distance & blind spots ----------
    gapAndBlindSpots(dt) {
      const G = this.G, P = G.player, st = this.st, pl = G.playerLoc;
      let lead = null;
      const fx = Math.cos(P.h), fy = Math.sin(P.h);
      const bl = { L: false, R: false };
      for (const o of G.traffic.vehicles) {
        const dx = o.x - P.x, dy = o.y - P.y;
        if (Math.abs(dx) > 120 || Math.abs(dy) > 120) continue;
        const f = dx * fx + dy * fy, r = dx * fy - dy * fx;
        if (f > 0 && f < 110 && Math.abs(r) < 1.6 && Math.cos(o.h - P.h) > 0.7) {
          const g = f - P.len / 2 - o.len / 2;
          if (!lead || g < lead.gap) lead = { gap: g, v: o.v, o };
        }
        // blind spots: beside and slightly behind the driver
        if (f > -7.5 && f < 1.0) { if (r < -1.0 && r > -4.6) bl.L = true; if (r > 1.0 && r < 4.6) bl.R = true; }
      }
      pl.blind = bl;
      const tg = lead && P.speed > 2 ? lead.gap / P.speed : null;
      pl.gapInfo = lead ? { gap: lead.gap, tg, lead } : null;
      const f = G.weather === 'snow' ? 1.5 : G.weather === 'rain' ? 1.2 : 1;
      if (tg !== null && P.speed > 8 && !pl.inNode) {
        if (tg < 1.5 * f) st.tailT += dt; else st.tailT = 0;
        if (tg < 3 * f) st.followT += dt; else st.followT = Math.max(0, st.followT - dt * 2);
        if (st.tailT > 2) { this.flag('TAILGATE', { cooldown: 15, detail: 'Gap: ' + tg.toFixed(1) + ' s.' }); st.tailT = 0; }
        else if (st.followT > 6) { this.flag('FOLLOW', { cooldown: 25, detail: 'Gap: ' + tg.toFixed(1) + ' s (target ' + (3 * f).toFixed(1) + ' s).' }); st.followT = 0; }
      } else { st.tailT = 0; st.followT = Math.max(0, st.followT - dt); }
    },

    // ---------- speed, lights, lanes, surfaces ----------
    checkGeneral(dt, loc) {
      const G = this.G, P = G.player, st = this.st, pl = G.playerLoc, net = G.net;
      const kmh = P.kmh;
      // seatbelt
      if (!P.seatbelt && P.speed > 1.5) this.flag('SEATBELT', { once: true });
      // pulling out from the curb at the start
      if (!st.pulledOut && P.speed > 1.2) {
        st.pulledOut = true;
        if (!P.sigL) this.flag('PULL_OUT_SIGNAL', { once: true });
        if (G.time - P.lastShoulderL > 6) this.flag('PULL_OUT_CHECK', { once: true });
        else if (P.sigL) G.examiner.praise('Good: signal and shoulder check before leaving the curb.', 'pullout');
      }
      // speeding
      const lim = pl.limit;
      if (lim && P.v > 0) {
        const over = kmh - lim;
        let tier = over > 30 ? 3 : over > 15 ? 2 : over > 5 ? 1 : 0;
        const school = pl.schoolZone && over > 3;
        if (tier > 0 || school) st.speedT += dt; else st.speedT = 0;
        if (st.speedT > 1.5) {
          const det = Math.round(kmh) + ' km/h in a ' + lim + ' zone.';
          if (school) this.flag('SCHOOL_ZONE_SPEED', { cooldown: 15, detail: det });
          else if (tier === 3) this.flag('SPEED_CRIT', { cooldown: 20, detail: det });
          else if (tier === 2) this.flag('SPEED_MAJOR', { cooldown: 15, detail: det });
          else this.flag('SPEED_MINOR', { cooldown: 15, detail: det });
        }
        if (G.weather === 'snow' && lim >= 50 && kmh > lim - 8) st.winterT += dt; else st.winterT = 0;
        if (st.winterT > 6) { this.flag('WINTER_SPEED', { cooldown: 45 }); st.winterT = 0; }
      }
      // highway
      const onHwy = loc.road && loc.road.kind === 'highway';
      if (onHwy && pl.laneInfo && pl.laneInfo.kind === 'lane') {
        const freeAhead = !pl.gapInfo || pl.gapInfo.gap > 70;
        if (kmh < 65 && freeAhead && !G.emergencies.some((e) => e.lightsOn && Math.hypot(e.x - P.x, e.y - P.y) < 200)) st.slowT += dt; else st.slowT = 0;
        if (st.slowT > 6) { this.flag('SLOW_DRIVING', { cooldown: 40 }); st.slowT = 0; }
        // keep right except to pass
        if (pl.laneInfo.lane === 0 && loc.road.n(pl.dir) > 1) {
          let rightBusy = false;
          for (const o of G.traffic.vehicles) {
            const rel = U.toLocal(o.x, o.y, P.x, P.y, P.h);
            if (rel.r > 1.5 && rel.r < 5.5 && rel.f > -25 && rel.f < 90) { rightBusy = true; break; }
          }
          if (!rightBusy) st.keepRightT += dt; else st.keepRightT = 0;
          if (st.keepRightT > 25) { this.flag('KEEP_RIGHT', { cooldown: 60 }); st.keepRightT = 0; }
        } else st.keepRightT = 0;
        // exit lane ahead: slowing in through lanes
        for (const a of loc.road.aux) {
          if (a.kind !== 'decel' || a.dir !== pl.dir) continue;
          const d = (a.s0 - loc.s) * a.dir;
          if (d > 0 && d < 250 && kmh < 70 && freeAhead && G.scenario.wantsExit && !st.exitSlowDone && !G.emergencies.some((e) => e.lightsOn && !e.staticEmergency && Math.hypot(e.x - P.x, e.y - P.y) < 250)) { st.exitSlowDone = true; this.flag('EXIT_SLOW'); }
        }
      }
      if (pl.laneInfo && pl.laneInfo.kind === 'shoulder' && st.lane && st.lane.kind === 'aux' && st.lane.aux.kind === 'accel' && P.speed > 3 && onHwy) {
        this.flag('ACCEL_END', { once: true });
      }
      if ((onHwy || loc.ramp) && P.gear === 'R' && P.speed > 0.5) this.flag('REVERSE_HWY', { cooldown: 30 });
      if (onHwy && pl.laneInfo && pl.laneInfo.kind === 'shoulder' && P.stoppedTime > 4 && !P.hazards) this.flag('HAZARDS_SHOULDER', { cooldown: 60 });
      // headlights
      const needLights = G.night || G.weather === 'snow' || G.weather === 'rain';
      if (needLights && !P.headlights && P.speed > 2) st.lightsT += dt; else st.lightsT = 0;
      if (st.lightsT > 8) { this.flag('HEADLIGHTS', { cooldown: 60 }); st.lightsT = 0; }
      // lane position
      const li = pl.laneInfo;
      if (li && !loc.node && P.speed > 1.5) {
        if (li.kind === 'wrongway') st.wrongT += dt; else st.wrongT = 0;
        if (st.wrongT > 1) { this.flag('WRONG_WAY', { cooldown: 20 }); st.wrongT = 0; }
        if (li.kind === 'oncoming') st.leftT += dt; else st.leftT = 0;
        if (st.leftT > 2.2) {
          const sc = G.traffic.vehicles.find((v) => v.type === 'streetcar' && Math.hypot(v.x - P.x, v.y - P.y) < 22 && Math.cos(v.h - P.h) > 0.7);
          if (sc) this.flag('STREETCAR_LEFT', { cooldown: 20 });
          else this.flag('LEFT_OF_CENTRE', { cooldown: 15 });
          st.leftT = 0;
        }
        if (li.kind === 'bike') {
          const ap = pl.approach;
          const turning = ap && ap.distEdge < 30 && P.signalDir() > 0;
          if (!turning) st.bikeT += dt;
        } else st.bikeT = 0;
        if (st.bikeT > 3) { this.flag('BIKE_LANE', { cooldown: 20 }); st.bikeT = 0; }
      } else { st.leftT = 0; st.wrongT = 0; }
      // signal left on
      // count only time spent driving along with the signal on (not waiting / approaching a turn)
      if (st.sigRef !== P.sigOnSince) { st.sigRef = P.sigOnSince; st.sigMoveT = 0; }
      if (st.lastManeuver > st.sigManRef) { st.sigManRef = st.lastManeuver; st.sigMoveT = 0; }
      if ((P.sigL || P.sigR) && P.sigOnSince > 0 && P.speed > 5 && !pl.inNode) {
        const approachingTurn = pl.approach && pl.approach.distEdge < 80;
        const pullingOver = pl.laneInfo && pl.laneInfo.kind !== 'lane';
        if (!approachingTurn && !pullingOver) st.sigMoveT += dt;
        if (st.sigMoveT > 9) { this.flag('SIGNAL_LEFT_ON', { cooldown: 30 }); st.sigMoveT = 0; }
      }
      // surfaces (curbs, off-road)
      // wheel contact points (body overhang may sweep over a curb without mounting it)
      const corners = U.boxCorners({ x: P.x, y: P.y, h: P.h, hl: P.L / 2, hw: P.wid / 2 - 0.33 });
      let curb = false, off = false;
      for (const c of corners) {
        const l = net.locate(c.x, c.y);
        if (l.surface === 'sidewalk') curb = true;
        if (l.surface === 'off' || l.surface === 'island' || (l.surface === 'shoulder' && !(l.road && (l.road.kind === 'highway' || l.road.rural)) && !l.ramp)) off = true;
      }
      if (curb && P.speed > 0.5) this.flag('CURB', { cooldown: 10 });
      else if (off && P.speed > 0.5) this.flag('OFFROAD', { cooldown: 10 });
      if (P.skidTime > 0.6 && P.speed > 4) this.flag('SKID', { cooldown: 15 });
    },

    // ---------- pedestrians, buses, streetcars, emergency vehicles ----------
    checkSpecial(dt, loc) {
      const G = this.G, P = G.player, st = this.st, pl = G.playerLoc, net = G.net;
      const pb = P.box(0.2);
      // pedestrians in crosswalks
      if (P.speed > 0.6) {
        for (const node of net.nodes) {
          if (!node.crosswalk) continue;
          if (Math.abs(node.x - P.x) > 40 || Math.abs(node.y - P.y) > 40) continue;
          for (let k = 0; k < 4; k++) {
            const cw = net.crosswalk(node, k);
            if (!cw) continue;
            const r = cw.rect;
            const over = U.boxCorners(pb).some((c) => c.x >= r.x0 && c.x <= r.x1 && c.y >= r.y0 && c.y <= r.y1) || U.pointInRect(P, r);
            if (!over) continue;
            const peds = G.peds.crosswalkPeds(node, k);
            // a pedestrian in (or about to enter) the car's path across this crosswalk
            const inPath = peds.some((p) => { const rl = U.toLocal(p.x, p.y, P.x, P.y, P.h); return rl.f > -1.5 && rl.f < 9 && Math.abs(rl.r) < 5.5; });
            if (inPath) this.flag('PED_YIELD', { key: 'ped' + node.id + k, cooldown: 12 });
          }
        }
      }
      // pedestrian crossovers & school crossings
      for (const f of net.features) {
        if (f.type !== 'pxo' && f.type !== 'schoolCrossing') continue;
        if (!loc.road || loc.road !== f.road || P.speed < 0.4) continue;
        if (Math.abs(loc.s - f.s) < 2.8 && G.peds.crossingOccupied(f)) {
          this.flag(f.type === 'pxo' ? 'PXO' : 'GUARD', { key: 'f' + f.s, cooldown: 15 });
        }
      }
      // school buses
      for (const b of G.traffic.vehicles) {
        if (b.type !== 'schoolbus' || !b.redFlash || b.seg.conn) continue;
        if (!loc.road || loc.road !== b.seg.road || loc.node) continue;
        const r = loc.road;
        const sB = b.seg.sStart + b.seg.dir * b.s;
        const d = (sB - loc.s) * pl.dir;
        const same = b.seg.dir === pl.dir;
        if (!same && r.median > 0) continue;
        if (Math.abs(d) > 80) continue;
        const key = b.id;
        if (same) {
          const g = d - b.len / 2 - P.len / 2;
          if (d < 0 && !st.busFlag.has(key + 'p')) { st.busFlag.add(key + 'p'); this.flag('SCHOOL_BUS_PASS', { cooldown: 1 }); }
          else if (g < 19 && g > -2 && P.speed > 0.5 && !st.busFlag.has(key + 'c')) { st.busFlag.add(key + 'c'); this.flag('SCHOOL_BUS_CLOSE', { cooldown: 1 }); }
        } else {
          const g = d - b.len / 2 - P.len / 2;
          if (d < 0 && !st.busFlag.has(key + 'p')) { st.busFlag.add(key + 'p'); this.flag('SCHOOL_BUS_PASS', { cooldown: 1, detail: 'Oncoming traffic must stop too (no median).' }); }
          else if (g < 4 && g > 0 && P.speed > 0.5 && !st.busFlag.has(key + 'c')) { st.busFlag.add(key + 'c'); this.flag('SCHOOL_BUS_CLOSE', { cooldown: 1 }); }
          else if (g < 25 && P.speed < 0.1) G.examiner.praise('Correct — you stopped for the school bus from the opposite direction.', 'busopp');
        }
        if (same && d > 0 && d - b.len / 2 - P.len / 2 >= 19 && P.speed < 0.1) G.examiner.praise('Good: stopped at least 20 m behind the school bus.', 'busbehind');
      }
      // streetcars with open doors
      for (const sc of G.traffic.vehicles) {
        if (sc.type !== 'streetcar' || sc.seg.conn) continue;
        const active = sc.doorsOpen || G.peds.streetcarPedsActive(sc);
        if (!active) { st.scFlag.delete(sc.id); continue; }
        if (!loc.road || loc.road !== sc.seg.road || loc.node || pl.dir !== sc.seg.dir || st.scFlag.has(sc.id)) continue;
        const sS = sc.seg.sStart + sc.seg.dir * sc.s;
        const rearDoor = sS - pl.dir * (sc.len / 2 - 3);
        const sFront = loc.s + pl.dir * P.len / 2;
        const q = pl.dir * loc.u, qsc = pl.dir * sc.seg.u;
        if (q > qsc + 1 && q - qsc < 7 && (sFront - (rearDoor - pl.dir * 2)) * pl.dir > 0 && (sFront - sS) * pl.dir < sc.len && P.speed > 0.3) {
          st.scFlag.add(sc.id);
          this.flag('STREETCAR_DOORS', { cooldown: 1 });
        }
      }
      // emergency vehicles
      for (const ev of G.emergencies) {
        if (ev.dead || !ev.lightsOn) continue;
        if (ev.staticEmergency) { this.checkMoveOver(ev, loc); continue; }
        let t = st.ev.get(ev.id);
        if (!t) { t = { seen: null, flagged: false, nonComp: 0 }; st.ev.set(ev.id, t); }
        if (t.flagged || ev.seg.conn || !loc.road || loc.road !== ev.seg.road) continue;
        const sE = ev.seg.sStart + ev.seg.dir * ev.s;
        const d = (sE - loc.s) * pl.dir; // + ahead, - behind
        const same = ev.seg.dir === pl.dir;
        const hwy = loc.road.kind === 'highway';
        const relevant = (same && d < 0 && d > -110) || (!same && !hwy && loc.road.median === 0 && d > 0 && d < 110);
        if (!relevant) { t.nonComp = 0; continue; }
        if (t.seen === null) { t.seen = G.time; DS.Bus.emit('hint', 'Emergency vehicle approaching! Signal, pull to the right and stop.'); }
        const li = pl.laneInfo;
        let comp;
        if (hwy) comp = li && ((li.kind === 'lane' && li.lane > ev.seg.lane) || li.kind === 'shoulder' || li.kind === 'aux') ;
        else {
          const n = loc.road.n(pl.dir);
          const rightPos = li && ((li.kind === 'lane' && li.lane === n - 1 && li.off > 0.25) || li.kind === 'bike' || li.kind === 'shoulder');
          comp = rightPos && P.speed < 1.6;
          if (pl.inNode) comp = true;
        }
        if (!comp && G.time - t.seen > 5 && Math.abs(d) < 45) t.nonComp += dt; else if (comp) t.nonComp = 0;
        if (t.nonComp > 2.5) { t.flagged = true; this.flag('EV_YIELD', { cooldown: 1 }); }
        else if (comp && Math.abs(d) < 15) G.examiner.praise('Well done — you pulled over for the emergency vehicle.', 'ev');
      }
    },

    checkMoveOver(ev, loc) {
      const G = this.G, P = G.player, st = this.st, pl = G.playerLoc;
      if (st.passedPolice.has(ev.id) || !loc.road || loc.road !== ev.seg.road || pl.dir !== ev.seg.dir) return;
      const sE = ev.seg.sStart + ev.seg.dir * ev.s;
      const d = (sE - loc.s) * pl.dir;
      if (d > 0 || d < -3) return;
      st.passedPolice.add(ev.id);
      const li = pl.laneInfo, n = loc.road.n(pl.dir);
      if (!li || li.kind !== 'lane') return;
      if (li.lane === n - 1) {
        let occupied = false;
        for (const o of G.traffic.vehicles) {
          const rel = U.toLocal(o.x, o.y, P.x, P.y, P.h);
          if (rel.r < -1.8 && rel.r > -5.2 && Math.abs(rel.f) < 18) occupied = true;
        }
        if (!occupied) this.flag('MOVE_OVER', { cooldown: 1 });
        else if (P.kmh > (pl.limit || 100) - 20) this.flag('MOVE_OVER_SLOW', { cooldown: 1 });
      } else G.examiner.praise('Good — you moved over for the stopped emergency vehicle.', 'moveover');
    },

    // ---------- collisions ----------
    checkCollisions(dt) {
      const G = this.G, P = G.player, st = this.st;
      const pb = P.box();
      for (const o of G.traffic.vehicles) {
        if (Math.abs(o.x - P.x) > 20 || Math.abs(o.y - P.y) > 20) continue;
        if (!U.obbOverlap(pb, o.box())) continue;
        const k = st.collideCool.get(o.id);
        if (k === undefined || G.time - k > 3) {
          st.collideCool.set(o.id, G.time);
          this.flag(o.kind === 'bike' ? 'COLLISION_PED' : 'COLLISION_VEH', { cooldown: 2 });
          DS.Bus.emit('crash', o);
        }
        this.separate(o.box(), 0.5);
        o.v = 0;
      }
      for (const p of G.peds.list) {
        if (Math.abs(p.x - P.x) > 6 || Math.abs(p.y - P.y) > 6) continue;
        const rel = U.toLocal(p.x, p.y, P.x, P.y, P.h);
        if (Math.abs(rel.f) < P.len / 2 + 0.25 && Math.abs(rel.r) < P.wid / 2 + 0.25 && P.speed > 0.8) {
          const k = st.collideCool.get(p.id);
          if (k === undefined || G.time - k > 3) { st.collideCool.set(p.id, G.time); this.flag('COLLISION_PED', { cooldown: 2 }); DS.Bus.emit('crash', p); }
          P.stopDead();
        }
      }
      for (const ob of G.world.obstacles) {
        if (P.x < ob.x0 - 6 || P.x > ob.x1 + 6 || P.y < ob.y0 - 6 || P.y > ob.y1 + 6) continue;
        const b = { x: (ob.x0 + ob.x1) / 2, y: (ob.y0 + ob.y1) / 2, h: 0, hl: (ob.x1 - ob.x0) / 2, hw: (ob.y1 - ob.y0) / 2 };
        if (!U.obbOverlap(pb, b)) continue;
        if (P.speed > 1.2) this.flag('COLLISION_OBJ', { cooldown: 4 });
        if (P.speed > 1.2) DS.Bus.emit('crash', ob);
        this.separate(b, 1);
      }
    },
    // push the player out of a box and kill speed
    separate(b, damp) {
      const P = this.G.player;
      for (let i = 0; i < 12 && U.obbOverlap(P.box(), b); i++) {
        const dx = P.x - b.x, dy = P.y - b.y, d = Math.hypot(dx, dy) || 1;
        P.x += (dx / d) * 0.12; P.y += (dy / d) * 0.12;
      }
      P.vx *= 1 - damp; P.vy *= 1 - damp; P.v *= 1 - damp;
      if (damp >= 1) P.stopDead();
    },
  };
  DS.Rules = R;
})();
