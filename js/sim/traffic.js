/* AI traffic: lane following, Intelligent Driver Model car-following,
 * intersection control (signals, all-way / two-way stops, roundabouts), yielding,
 * highway lane changes and special vehicles (streetcars, school buses, emergency vehicles, cyclists).
 */
(function () {
  'use strict';
  const DS = window.DS, U = DS.U;

  const TYPES = {
    car: { len: 4.5, wid: 1.8, a: 1.8, b: 2.6, colors: [0x2b5fa8, 0xb22222, 0x333a40, 0xd9d9d9, 0x1f6b45, 0x7a7f87, 0x0e0e10, 0x8a1538, 0xc9a227] },
    suv: { len: 4.9, wid: 1.95, a: 1.6, b: 2.5, colors: [0x23272c, 0xe8e8e8, 0x5b6770, 0x3d2b1f, 0x16365c] },
    van: { len: 5.6, wid: 2.0, a: 1.3, b: 2.3, colors: [0xf2f2f2, 0x9aa0a6] },
    truck: { len: 9.5, wid: 2.5, a: 0.9, b: 2.0, colors: [0xe8e8e8, 0x1d4e89, 0xa83232] },
    taxi: { len: 4.7, wid: 1.85, a: 1.9, b: 2.7, colors: [0xffcc00] },
    streetcar: { len: 30, wid: 2.6, a: 1.0, b: 1.6, colors: [0xd52b1e] },
    schoolbus: { len: 11, wid: 2.5, a: 1.0, b: 2.0, colors: [0xffb800] },
    ambulance: { len: 6.5, wid: 2.2, a: 2.6, b: 3.5, colors: [0xffffff] },
    fire: { len: 9.5, wid: 2.5, a: 1.9, b: 3.0, colors: [0xc8102e] },
    police: { len: 4.9, wid: 1.9, a: 2.6, b: 3.5, colors: [0x111111] },
    bike: { len: 1.8, wid: 0.7, a: 1.0, b: 2.0, colors: [0x2a9d8f, 0xe76f51, 0x264653, 0xf4a261] },
  };
  DS.VTYPES = TYPES;

  let NEXT_ID = 1;

  class AIVehicle {
    constructor(traffic, type, seg, s, opts = {}) {
      const T = TYPES[type];
      this.traffic = traffic;
      this.id = 'v' + NEXT_ID++;
      this.kind = type === 'bike' ? 'bike' : 'veh';
      this.type = type;
      this.len = T.len; this.wid = T.wid;
      this.amax = T.a; this.bcomf = T.b;
      this.color = opts.color !== undefined ? opts.color : U.pick(T.colors);
      this.seg = seg; this.s = s;
      this.v = opts.v !== undefined ? opts.v : 0;
      this.acc = 0;
      this.latOff = 0; this.latTarget = 0;
      this.personal = opts.personal || U.rand(0.92, 1.08);
      this.plan = null;
      this.sigL = false; this.sigR = false; this.hazards = false; this.brakeLight = false;
      this.emergency = type === 'ambulance' || type === 'fire' || (type === 'police' && opts.emergency);
      this.lightsOn = this.emergency || !!opts.lightsOn;
      this.static = !!opts.static;
      this.stopDone = false; this.stopTime = 0; this.released = false; this.committed = false;
      this.waitTime = 0;
      this.pullOver = false;
      this.dead = false;
      this.x = 0; this.y = 0; this.h = 0;
      this.script = opts.script || null; // special behaviour (school bus / streetcar stops)
      this.doorsOpen = false;
      this.stopArm = false; this.amberFlash = false; this.redFlash = false;
      this.laneChange = null; this._lcCheck = U.rand(0, 2);
      this.leaderId = null; this.leaderSince = 0;
      this.honk = 0;
      this.fixedRoute = opts.fixedRoute || null; // forced moves list
      this.desiredOverride = opts.desired || null;
      this.updatePose();
    }

    get kmh() { return this.v * 3.6; }
    get road() { return this.seg.conn ? null : this.seg.road; }
    box(pad = 0) { return { x: this.x, y: this.y, h: this.h, hl: this.len / 2 + pad, hw: this.wid / 2 + pad }; }

    updatePose() {
      const p = this.seg.poly.at(U.clamp(this.s, 0, this.seg.len));
      const rx = p.hy, ry = -p.hx;
      this.x = p.x + rx * this.latOff;
      this.y = p.y + ry * this.latOff;
      // heading: lane change adds a small yaw
      let h = p.heading;
      if (Math.abs(this.latTarget - this.latOff) > 0.05 && this.v > 1) h -= U.clamp((this.latTarget - this.latOff) * 0.12, -0.25, 0.25) * Math.sign(this.v);
      this.h = h;
    }

    // point on own planned path `d` metres ahead (for curved-path leader detection)
    lookPoint(d) {
      let seg = this.seg, s = this.s + d;
      if (s > seg.len) {
        const next = seg.conn ? seg.toSeg : this.plan && this.plan.conn;
        if (next) {
          s -= seg.len; seg = next;
          if (s > seg.len && seg.conn && seg.toSeg) { s -= seg.len; seg = seg.toSeg; }
        }
      }
      return seg.poly.at(U.clamp(s, 0, seg.len));
    }

    choosePlan() {
      const net = this.traffic.net, seg = this.seg;
      if (!seg.toNode) { this.plan = { move: 'END' }; return; }
      let moves = net.movesFrom(seg);
      if (this.type === 'streetcar' || this.type === 'bike') moves = moves.filter((m) => m.move === 'S');
      if (this.fixedRoute && this.fixedRoute.length) {
        const want = this.fixedRoute[0];
        const m = moves.find((mm) => mm.move === want);
        if (m) { this.fixedRoute.shift(); moves = [m]; }
      }
      if (!moves.length) { this.plan = { move: 'END' }; return; }
      // weight: straight preferred
      const w = moves.map((m) => (m.move === 'S' ? 3 : m.move === 'U' ? 0.15 : 1));
      let r = Math.random() * w.reduce((a, b) => a + b, 0), mv = moves[0];
      for (let i = 0; i < moves.length; i++) { r -= w[i]; if (r <= 0) { mv = moves[i]; break; } }
      const conn = net.connector(seg, mv);
      if (!conn) { this.plan = { move: 'END' }; return; }
      this.plan = { move: mv.move, armOut: mv.armOut, laneOut: mv.laneOut, conn };
    }

    desiredSpeed(G) {
      if (this.desiredOverride) return this.desiredOverride;
      const seg = this.seg;
      let lim;
      if (seg.conn) {
        if (seg.node.ring) lim = 26;
        else lim = seg.move === 'S' ? (seg.fromSeg.road.limit) : 20;
      } else {
        lim = this.traffic.net.speedLimit(seg.road, seg.dir, seg.sStart + seg.dir * this.s, G.schoolActive) || 50;
      }
      if (this.type === 'bike') return U.rand(4.8, 5.2) * this.personal;
      let v = (lim / 3.6) * this.personal;
      if (this.emergency && this.lightsOn) v = (lim + 25) / 3.6;
      if (G.weather === 'snow') v *= 0.82;
      else if (G.weather === 'rain') v *= 0.93;
      return v;
    }

    update(dt, G) {
      if (this.static) { this.v = 0; this.updatePose(); return; }
      const T = this.traffic;
      if (!this.seg.conn && !this.plan) this.choosePlan();
      if (this.script && this.script.update) this.script.update(this, dt, G);

      // signals for planned turns
      if (!this.seg.conn && this.plan && this.seg.toNode) {
        const toEnd = this.seg.len - this.s;
        const turnSig = toEnd < 50 && (this.plan.move === 'L' || this.plan.move === 'R' || (this.seg.toNode.ring && this.plan.move !== 'END'));
        if (!this.laneChange && !this.pullOver) {
          if (this.seg.toNode.ring) { this.sigL = toEnd < 40 && (this.plan.move === 'L' || this.plan.move === 'U'); this.sigR = toEnd < 40 && this.plan.move === 'R'; }
          else { this.sigL = turnSig && this.plan.move === 'L'; this.sigR = turnSig && this.plan.move === 'R'; }
        }
      } else if (this.seg.conn && this.seg.node.ring && !this.laneChange) {
        const rem = this.seg.len - this.s;
        this.sigL = false; this.sigR = rem < 22;
      } else if (!this.laneChange && !this.pullOver && !this.seg.conn) { this.sigL = this.sigR = false; }

      let v0 = this.desiredSpeed(G);
      let acc = this.idmFree(v0);
      let blockedBy = null;

      // ---- approaching turn: slow to turning speed ----
      if (!this.seg.conn && this.plan && this.plan.move !== 'END' && this.plan.move !== 'S') {
        const vt = this.seg.toNode.ring ? 6.5 : 5.2;
        const d = this.seg.len - this.s;
        const vAllowed = Math.sqrt(vt * vt + 2 * 1.6 * Math.max(0, d - 3));
        if (this.v > vAllowed) acc = Math.min(acc, -1.8 * (this.v - vAllowed) / Math.max(1, vAllowed) - 0.4);
      } else if (!this.seg.conn && this.plan && this.seg.toNode && this.seg.toNode.ring) {
        const vt = 7, d = this.seg.len - this.s;
        const vAllowed = Math.sqrt(vt * vt + 2 * 1.6 * Math.max(0, d - 3));
        if (this.v > vAllowed) acc = Math.min(acc, -1.5);
      }

      // ---- leader (vehicles, player, cyclists, pedestrians) ----
      const L = this.findLeader(G);
      if (L) {
        const aL = this.idm(v0, L.gap, L.v);
        if (aL < acc) { acc = aL; blockedBy = L.ent; }
      }
      // ---- virtual stops (stop lines, yielding, school bus, streetcar, PXO...) ----
      const stopGap = this.virtualStop(G);
      if (stopGap !== null) {
        const aS = this.idm(v0, Math.max(0.05, stopGap), 0, 0.6);
        if (aS < acc) { acc = aS; blockedBy = 'stop'; }
      }
      // ---- yield to emergency vehicles ----
      if (!this.emergency && this.type !== 'streetcar') this.checkEmergency(G);
      if (this.pullOver) { acc = Math.min(acc, this.v > 0.3 ? -2.5 : -0.5); }

      // hard-braking because of the player => examiner flag (failure to yield / cut-off)
      if (blockedBy && blockedBy.kind === 'player') {
        if (this.leaderId !== 'player') { this.leaderId = 'player'; this.leaderSince = G.time; }
        if (acc < -4.2 && this.v > 4 && G.player.speed > 1.5 && G.time - this.leaderSince < 2.5) G.events.push({ type: 'cutoff', veh: this });
        if (this.v < 0.2 && G.player.speed < 0.2) this.honk += dt; else this.honk = 0;
      } else if (!blockedBy || blockedBy.kind !== 'player') { this.leaderId = blockedBy ? blockedBy.id : null; }

      // deadlock breaker between two AI vehicles blocking each other
      this.blockedBy = blockedBy && blockedBy.id ? blockedBy : null;
      if (this.v < 0.2 && this.blockedBy && this.blockedBy.blockedBy === this && this.id < this.blockedBy.id) acc = Math.max(acc, 0.8);
      if (this.v < 0.2 && blockedBy) this.waitTime += dt; else if (this.v > 1) this.waitTime = 0;
      if (this.waitTime > 12 && this.blockedBy && this.blockedBy.kind !== 'player' && this.blockedBy.v < 0.2 && this.seg.conn) acc = Math.max(acc, 0.6);

      acc = U.clamp(acc, -9, this.amax);
      this.acc = acc;
      this.v = Math.max(0, this.v + acc * dt);
      this.brakeLight = acc < -0.6 || this.v < 0.3;
      this.s += this.v * dt;

      // lateral
      const latRate = this.pullOver ? 1.0 : 0.9;
      this.latOff = U.approach(this.latOff, this.latTarget, latRate * dt);
      if (this.laneChange && Math.abs(this.latOff - this.latTarget) < 0.05) { this.laneChange = null; this.sigL = this.sigR = false; }
      if (this.seg.road && this.seg.road.kind === 'highway' && !this.emergency) this.highwayLaneLogic(dt, G);

      // segment transitions
      let guard = 0;
      while (this.s > this.seg.len && guard++ < 3) {
        const over = this.s - this.seg.len;
        if (this.seg.conn) {
          this.leaveNode();
          this.seg = this.seg.toSeg; this.s = over; this.plan = null;
          this.stopDone = false; this.released = false; this.committed = false;
          this.latOff = 0; this.latTarget = this.pullOver ? this.latTarget : 0;
          if (this.script && this.script.onSeg) this.script.onSeg(this, G);
        } else {
          if (!this.plan) this.choosePlan();
          if (!this.plan || this.plan.move === 'END' || !this.plan.conn) { this.dead = true; return; }
          this.seg = this.plan.conn; this.s = over; this.latOff = 0; this.latTarget = 0; this.laneChange = null;
        }
      }
      this.updatePose();
    }

    leaveNode() {
      const node = this.seg.node;
      if (node) node.queue.delete(this.id);
    }

    idmFree(v0) {
      return this.amax * (1 - Math.pow(this.v / Math.max(v0, 0.1), 4));
    }
    idm(v0, gap, vl, s0) {
      const T = this.traffic.G.weather === 'snow' ? 2.1 : 1.35;
      const ss = (s0 !== undefined ? s0 : 2.2) + Math.max(0, this.v * T + (this.v * (this.v - vl)) / (2 * Math.sqrt(this.amax * this.bcomf)));
      return this.amax * (1 - Math.pow(this.v / Math.max(v0, 0.1), 4) - Math.pow(ss / Math.max(gap, 0.1), 2));
    }

    findLeader(G) {
      const look = Math.max(22, this.v * 3.6 + 12);
      const fx = Math.cos(this.h), fy = Math.sin(this.h);
      let best = null;
      const consider = (o, w2, l2, vo, ho) => {
        if (o === this) return;
        const dx = o.x - this.x, dy = o.y - this.y;
        if (Math.abs(dx) > look + 15 || Math.abs(dy) > look + 15) return;
        const f = dx * fx + dy * fy;
        if (f <= 0.5 || f > look + l2 / 2 + this.len / 2) return;
        const p = this.lookPoint(Math.max(0, f - this.len / 2 * 0));
        const lat = Math.hypot(o.x - (p.x + p.hy * this.latOff), o.y - (p.y - p.hx * this.latOff));
        const corr = this.wid / 2 + w2 / 2 + (this.type === 'bike' ? 0.2 : 0.35);
        if (lat > corr) return;
        const gap = f - this.len / 2 - l2 / 2;
        if (!best || gap < best.gap) {
          const vl = Math.max(0, vo * Math.cos(ho - this.h));
          best = { ent: o, gap, v: vl };
        }
      };
      for (const o of this.traffic.vehicles) {
        if (o.dead || o === this) continue;
        if (this.emergency && o.pullOver) continue;
        consider(o, o.wid, o.len, o.v, o.h);
      }
      const P = G.player;
      consider(P, P.wid, P.len, Math.max(0, P.v), P.h);
      if (G.peds) for (const p of G.peds.list) if (p.onRoad) consider(p, 0.8, 0.8, 0, p.h);
      return best;
    }

    // Returns gap (m) to a virtual stop point, or null if free to proceed
    virtualStop(G) {
      const net = this.traffic.net;
      let gap = null;
      const take = (g) => { if (g !== null && (gap === null || g < gap)) gap = g; };
      const seg = this.seg;
      if (this.scriptStop !== null && this.scriptStop !== undefined) take(this.scriptStop);
      if (!seg.conn && seg.toNode && this.plan && this.plan.move !== 'END') {
        const node = seg.toNode;
        const dStop = seg.len - seg.stopDist - this.s - this.len / 2; // front bumper to stop line
        if (dStop < 70 && !this.committed) take(this.nodeDecision(G, node, seg, dStop));
      }
      // school buses with red lights (both directions unless a median separates)
      for (const b of this.traffic.vehicles) {
        if (b.type !== 'schoolbus' || !b.redFlash || b === this || this.emergency) continue;
        const rel = this.relAlongRoad(b);
        if (!rel) continue;
        if (rel.same && rel.d > -2) take(rel.d - b.len / 2 - this.len / 2 - 20);
        else if (!rel.same && !rel.median && rel.d > 0) take(rel.d - b.len / 2 - this.len / 2 - 10);
      }
      // streetcar doors open: stop 2 m behind rear doors (traffic in lanes to its right)
      for (const sc of this.traffic.vehicles) {
        if (sc.type !== 'streetcar' || !sc.doorsOpen || sc === this) continue;
        const rel = this.relAlongRoad(sc);
        if (rel && rel.same && rel.d > 0) take(rel.d - sc.len / 2 - this.len / 2 - 2.5);
      }
      // pedestrian crossovers / school crossings
      if (!seg.conn && G.peds) {
        for (const f of net.features) {
          if ((f.type !== 'pxo' && f.type !== 'schoolCrossing') || f.road !== seg.road) continue;
          const d = (f.s - (seg.sStart + seg.dir * this.s)) * seg.dir - this.len / 2 - 3.5;
          if (d < -1 || d > 50) continue;
          if (G.peds.crossingOccupied(f)) take(d);
        }
      }
      return gap;
    }

    // relative position of another vehicle along the same road
    relAlongRoad(o) {
      if (this.seg.conn || o.seg.conn || this.seg.road !== o.seg.road) return null;
      const r = this.seg.road;
      const sMe = this.seg.sStart + this.seg.dir * this.s, sO = o.seg.sStart + o.seg.dir * o.s;
      return { same: o.seg.dir === this.seg.dir, d: (sO - sMe) * this.seg.dir, median: r.median > 0, lane: o.seg.lane };
    }

    nodeDecision(G, node, seg, dStop) {
      const net = this.traffic.net, k = seg.toArm.k, mv = this.plan;
      if (this.emergency && this.lightsOn) {
        // emergency vehicles proceed with caution through controls
        if (dStop < 12 && this.v > 7) return dStop + 25; // slows a little
        return null;
      }
      if (seg.bike) {
        if (node.control === 'signal' && net.light(node, k) !== 'G' && dStop > 1) return dStop;
        if (node.stopArms.has(k) && !this.stopDone) { if (this.v < 0.3 && dStop < 2) { this.stopDone = true; return null; } return dStop; }
        return null;
      }
      const exitBlocked = () => {
        const out = mv.conn.toSeg;
        for (const o of this.traffic.vehicles) if (o !== this && o.seg === out && o.s < this.len + 4 && o.v < 2) return true;
        return false;
      };
      switch (node.control) {
        case 'signal': {
          const light = net.light(node, k);
          if (light === 'R') { this.ambCommit = false; return dStop; }
          if (light === 'Y') {
            if (this.ambCommit) return null;
            if (dStop > (this.v * this.v) / (2 * 3.2) + 1) return dStop;
            this.ambCommit = true; return null;
          }
          this.ambCommit = false;
          if (dStop > 25) return null;
          if (exitBlocked()) return dStop;
          if (mv.move === 'L' && this.oncomingConflict(G, node, k)) return dStop + (node.crosswalk ? 4 : 2);
          if ((mv.move === 'L' || mv.move === 'R') && G.peds && G.peds.crosswalkBusy(node, mv.armOut)) return dStop + (mv.move === 'L' ? 4 : 0.5);
          if (dStop < 1.5 && this.v < 3) this.committed = true;
          return null;
        }
        case 'stop4':
        case 'stop2': {
          if (!node.stopArms.has(k)) {
            if (dStop > 25) return null;
            if (mv.move === 'L' && this.oncomingConflict(G, node, k)) return dStop;
            if ((mv.move === 'L' || mv.move === 'R') && G.peds && G.peds.crosswalkBusy(node, mv.armOut)) return dStop;
            return null;
          }
          if (!this.stopDone) {
            if (this.v < 0.25 && dStop < 2.5) {
              this.stopDone = true; this.stopTime = G.time;
              node.queue.set(this.id, { t: G.time, arm: k, ent: this });
            }
            return dStop;
          }
          if (this.released) return null;
          const waited = G.time - this.stopTime;
          let ok = waited > 1.0 && (node.control === 'stop4' ? this.canGo4way(G, node, k, waited) : this.canGo2way(G, node, k));
          if (ok && (mv.move === 'L' || mv.move === 'R') && G.peds && G.peds.crosswalkBusy(node, mv.armOut)) ok = false;
          if (ok && exitBlocked()) ok = false;
          if (ok) { this.released = true; this.committed = true; return null; }
          return dStop;
        }
        case 'roundabout': {
          if (dStop > 20) return null;
          if (this.ringConflict(G, node, seg)) return dStop;
          if (exitBlocked()) return dStop;
          if (dStop < 2) this.committed = true;
          return null;
        }
        default:
          return null;
      }
    }

    boxOccupied(G, node) {
      const inBox = (e) => (node.ring ? Math.hypot(e.x - node.x, e.y - node.y) < node.ring.r1 : U.pointInRect(e, node.box));
      for (const o of this.traffic.vehicles) if (o !== this && o.kind === 'veh' && inBox(o)) return true;
      if (inBox(G.player)) return true;
      return false;
    }

    canGo4way(G, node, k, waited) {
      if (this.boxOccupied(G, node)) return false;
      const me = node.queue.get(this.id);
      if (!me) return true;
      for (const [id, e] of node.queue) {
        if (id === this.id) continue;
        if (e.ent && e.ent.dead) { node.queue.delete(id); continue; }
        if (e.t < me.t - 0.6) {
          if (id === 'player' && waited > 5) continue; // player hesitating: proceed
          return false;
        }
        if (Math.abs(e.t - me.t) <= 0.6 && e.arm === (me.arm + 3) % 4) {
          if (waited > 6) continue; // four-way tie breaker
          return false;
        }
      }
      return true;
    }

    canGo2way(G, node, k) {
      if (this.boxOccupied(G, node)) return false;
      // gap in through traffic
      const ents = this.traffic.vehicles.concat([G.player]);
      for (const o of ents) {
        if (o === this || o.kind === 'bike') continue;
        const a = this.approachInfo(o, node);
        if (!a || node.stopArms.has(a.k)) continue;
        if (a.dist < 55 && (a.dist / Math.max(o.v, 0.5) < 5.5 || a.dist < 6) && (o.v > 1 || a.dist < 6)) return false;
      }
      return true;
    }

    // Is entity o approaching node? returns {k (arm it comes from), dist to box}
    approachInfo(o, node) {
      if (o.kind === 'player') {
        const l = this.traffic.G.playerLoc;
        if (l && l.approach && l.approach.node === node) return { k: l.approach.k, dist: l.approach.distEdge, move: l.approach.intent };
        return null;
      }
      if (!o.seg || o.seg.conn || o.seg.toNode !== node || !o.seg.toArm) return null;
      return { k: o.seg.toArm.k, dist: o.seg.len - o.s - o.len / 2, move: o.plan ? o.plan.move : 'S' };
    }

    oncomingConflict(G, node, k) {
      const ko = (k + 2) % 4;
      const ents = this.traffic.vehicles.concat([G.player]);
      for (const o of ents) {
        if (o === this || o.kind === 'bike') continue;
        const a = this.approachInfo(o, node);
        if (a && a.k === ko && a.move !== 'L') {
          if (a.dist < 6 || (a.dist < 70 && a.dist / Math.max(o.v, 0.1) < 4.8 && o.v > 1.5)) return true;
        }
        if (o.seg && o.seg.conn && o.seg.node === node && o.seg.armIn === ko && o.seg.move !== 'L' && o.s < o.seg.len * 0.8) return true;
        if (o.kind === 'player' && G.playerLoc && G.playerLoc.nodeEntry && G.playerLoc.nodeEntry.node === node && G.playerLoc.nodeEntry.k === ko) return true;
      }
      return false;
    }

    ringConflict(G, node, seg) {
      const p = seg.poly.pts[1];
      const aE = Math.atan2(p.y - node.y, p.x - node.x);
      const ents = this.traffic.vehicles.concat([G.player]);
      for (const o of ents) {
        if (o === this || o.kind === 'bike') continue;
        const d = Math.hypot(o.x - node.x, o.y - node.y);
        if (d > node.ring.r1 + 1 || d < node.ring.r0 - 1) continue;
        if (o.seg && o.seg.conn && o.seg.armOut === seg.toArm.k && o.s > o.seg.len - 12) continue; // leaving here
        if (o.seg && o.seg.conn && o.seg.armIn === seg.toArm.k && o.s < 6) continue;
        const a = Math.atan2(o.y - node.y, o.x - node.x);
        const delta = U.angNorm(aE - a);
        if (delta > -0.35 && delta < 1.5) return true;
      }
      return false;
    }

    checkEmergency(G) {
      let near = false;
      if (this.seg.conn) { this.pullOver = false; return; }
      for (const ev of G.emergencies) {
        if (ev.dead || !ev.lightsOn || ev.static) continue;
        if (ev.seg.conn) continue;
        const rel = this.relAlongRoad(ev);
        if (!rel) continue;
        if ((rel.same && rel.d < 0 && rel.d > -90) || (!rel.same && !rel.median && rel.d > 0 && rel.d < 90 && this.seg.road.kind !== 'highway')) near = true;
      }
      if (near && !this.pullOver) {
        this.pullOver = true; this.hazards = false;
        const r = this.seg.road;
        if (r.kind === 'highway') this.latTarget = this.seg.lane === r.n(this.seg.dir) - 1 ? 1.6 : 0; else this.latTarget = this.seg.lane === r.n(this.seg.dir) - 1 || r.n(this.seg.dir) === 1 ? 1.2 : 0;
        this.sigR = true;
        this._pullT = G.time;
      } else if (!near && this.pullOver && G.time - this._pullT > 2) {
        this.pullOver = false; this.latTarget = 0; this.sigR = false;
      }
    }

    highwayLaneLogic(dt, G) {
      if (this.seg.conn || this.laneChange || this.pullOver || this.type === 'truck' && Math.random() < 0.5) return;
      this._lcCheck -= dt;
      if (this._lcCheck > 0) return;
      this._lcCheck = U.rand(1.5, 3.5);
      const r = this.seg.road, n = r.n(this.seg.dir), lane = this.seg.lane;
      const L = this.findLeader(G);
      const v0 = this.desiredSpeed(G);
      const P = G.player, pl = G.playerLoc;
      // courtesy: make room for a merging player
      if (pl && pl.laneInfo && pl.laneInfo.kind === 'aux' && pl.laneInfo.aux.kind === 'accel' && lane === n - 1) {
        const rel = U.toLocal(P.x, P.y, this.x, this.y, this.h);
        if (rel.f > -10 && rel.f < 60 && Math.random() < 0.5 && this.tryLane(G, lane - 1)) return;
      }
      // Move Over: vacate the lane next to a stopped emergency vehicle on the shoulder
      if (lane === n - 1) {
        for (const e of G.emergencies) {
          if (!e.staticEmergency) continue;
          const rel = U.toLocal(e.x, e.y, this.x, this.y, this.h);
          if (rel.f > 0 && rel.f < 220 && Math.random() < 0.8 && this.tryLane(G, lane - 1)) return;
        }
      }
      if (L && L.v < v0 - 2.5 && L.gap < 70 && lane > 0) { if (this.tryLane(G, lane - 1)) return; }
      if (lane < n - 1 && (!L || L.gap > 90) && Math.random() < 0.35) this.tryLane(G, lane + 1);
    }

    tryLane(G, lane) {
      const r = this.seg.road, dir = this.seg.dir;
      if (lane < 0 || lane >= r.n(dir)) return false;
      const sNow = this.seg.sStart + dir * this.s;
      const target = this.traffic.net.segAt(r, dir, lane, sNow);
      if (!target) return false;
      const uT = target.u, uC = this.seg.u;
      const ents = this.traffic.vehicles.concat([G.player]);
      for (const o of ents) {
        if (o === this) continue;
        const rel = U.toLocal(o.x, o.y, this.x, this.y, this.h);
        // lateral position of o relative to target lane centre
        const qT = dir * (uT - uC); // offset of target lane in my right-frame
        if (Math.abs(rel.r - qT) > 2.6) continue;
        const ahead = rel.f > 0;
        const g = Math.abs(rel.f) - this.len / 2 - (o.len || 4.5) / 2;
        if (ahead && g < Math.max(14, this.v * 1.1)) return false;
        if (!ahead && g < Math.max(10, (o.v || 0) * 1.6 + (o.v - this.v) * 2)) return false;
      }
      const sOnTarget = (sNow - target.sStart) * dir;
      this.seg = target; this.s = sOnTarget;
      // keep position continuous: offset = q_old - q_new (q = right-positive lateral in travel frame)
      this.latOff = dir * uC - dir * uT;
      this.latTarget = 0;
      this.laneChange = { to: lane };
      if (this.latOff < 0) { this.sigR = true; this.sigL = false; } else { this.sigL = true; this.sigR = false; }
      this.plan = null;
      return true;
    }
  }

  class Traffic {
    constructor(G, net) {
      this.G = G; this.net = net;
      this.vehicles = [];
      this.target = 0;
      this.spawnTimer = 0;
    }
    add(type, seg, s, opts) {
      const v = new AIVehicle(this, type, seg, s, opts);
      this.vehicles.push(v);
      if (v.emergency || v.type === 'police') this.G.emergencies.push(v);
      DS.Bus.emit('vehicleAdded', v);
      return v;
    }
    remove(v) {
      if (v._removed) return;
      v._removed = true;
      v.dead = true;
      for (const n of this.net.nodes) n.queue.delete(v.id);
      DS.Bus.emit('vehicleRemoved', v);
    }
    freeAt(seg, s, clear) {
      const p = seg.poly.at(s);
      for (const o of this.vehicles) if (Math.hypot(o.x - p.x, o.y - p.y) < clear) return false;
      const P = this.G.player;
      if (Math.hypot(P.x - p.x, P.y - p.y) < clear + 6) return false;
      return true;
    }
    randomType() {
      const sc = this.G.scenario;
      const mix = (sc && sc.vehicleMix) || { car: 6, suv: 3, van: 1, truck: 0.5, taxi: 0.3 };
      const keys = Object.keys(mix);
      let r = Math.random() * keys.reduce((a, k) => a + mix[k], 0);
      for (const k of keys) { r -= mix[k]; if (r <= 0) return k; }
      return 'car';
    }
    trySpawn(minD, maxD, opts = {}) {
      const P = this.G.player;
      const cands = this.net.segs.filter((s) => !s.bike && s.len > 25 && (!opts.road || s.road === opts.road) && (opts.allowStreetcarOnly !== true));
      for (let tries = 0; tries < 12; tries++) {
        const seg = U.pick(cands);
        if (!seg) return null;
        const s = U.rand(6, seg.len - 14);
        const p = seg.poly.at(s);
        const d = Math.hypot(p.x - P.x, p.y - P.y);
        if (d < minD || d > maxD) continue;
        if (!this.freeAt(seg, s, 14)) continue;
        if (this.G.camera && this.G.inView && d < 140 && this.G.inView(p.x, p.y)) continue;
        const type = opts.type || this.randomType();
        const lim = this.net.speedLimit(seg.road, seg.dir, seg.sStart + seg.dir * s, this.G.schoolActive) || 50;
        return this.add(type, seg, s, { v: (lim / 3.6) * 0.8 });
      }
      return null;
    }
    spawnBike(minD, maxD) {
      const P = this.G.player;
      const cands = this.net.segs.filter((s) => s.bike && s.len > 25);
      if (!cands.length) return null;
      for (let tries = 0; tries < 10; tries++) {
        const seg = U.pick(cands);
        const s = U.rand(4, seg.len - 8);
        const p = seg.poly.at(s);
        const d = Math.hypot(p.x - P.x, p.y - P.y);
        if (d < minD || d > maxD || !this.freeAt(seg, s, 8)) continue;
        return this.add('bike', seg, s, { v: 4.5 });
      }
      return null;
    }
    update(dt) {
      const G = this.G;
      for (const v of this.vehicles) if (!v.dead) v.update(dt, G);
      // despawn far away
      const P = G.player;
      for (const v of this.vehicles) {
        if (v.dead) continue;
        if (v.keep) continue;
        const d = Math.hypot(v.x - P.x, v.y - P.y);
        if (d > (G.scenario.despawnDist || 300)) this.remove(v);
      }
      for (const v of this.vehicles) if (v.dead) this.remove(v);
      this.vehicles = this.vehicles.filter((v) => !v.dead);
      G.emergencies = G.emergencies.filter((v) => !v.dead);
      // maintain density
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 0.4;
        const sc = G.scenario;
        const cars = this.vehicles.filter((v) => v.kind === 'veh' && !v.keep).length;
        if (cars < (sc.traffic.cars || 0)) {
          if (sc.spawn) sc.spawn(G, this); else this.trySpawn(110, 260);
        }
        const bikes = this.vehicles.filter((v) => v.kind === 'bike').length;
        if (bikes < (sc.traffic.bikes || 0)) this.spawnBike(60, 220);
      }
    }
  }

  DS.AIVehicle = AIVehicle;
  DS.Traffic = Traffic;
})();
