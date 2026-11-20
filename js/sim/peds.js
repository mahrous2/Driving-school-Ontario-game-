/* Pedestrians: intersection crosswalk users, pedestrian crossovers (PXO), school crossings with a
 * crossing guard, streetcar passengers and children leaving school buses.
 */
(function () {
  'use strict';
  const DS = window.DS, U = DS.U, C = DS.C;

  const SHIRTS = [0xc0392b, 0x2980b9, 0x27ae60, 0x8e44ad, 0xf39c12, 0x2c3e50, 0xecf0f1, 0x16a085, 0xd35400, 0x34495e, 0x7f8c8d, 0xe84393];
  const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x5c3a21];
  let NEXT = 1;

  class Ped {
    constructor(o) {
      this.id = 'p' + NEXT++;
      this.kind = 'ped';
      this.x = o.path[0].x; this.y = o.path[0].y; this.h = 0;
      this.path = o.path; this.pi = 1;
      this.speed = o.speed || U.rand(1.15, 1.5);
      this.v = 0;
      this.role = o.role || 'walker';
      this.kid = !!o.kid;
      this.color = o.color || U.pick(SHIRTS);
      this.skin = U.pick(SKIN);
      this.waitAt = o.waitAt !== undefined ? o.waitAt : -1; // path index where it waits for permission
      this.canGo = o.canGo || null; // () => bool
      this.onRoad = false;
      this.done = false;
      this.cw = o.cw || null; this.feature = o.feature || null;
      this.onArrive = o.onArrive || null;
      this.phase = Math.random() * 6;
      this.waiting = false;
      this.sign = !!o.sign; // crossing guard stop sign
      this.hold = o.hold || null; // () => bool : stay at current target
      this.len = 0.6; this.wid = 0.6;
    }
  }

  class Peds {
    constructor(G, net) {
      this.G = G; this.net = net;
      this.list = [];
      this.timer = 0;
    }
    add(o) { const p = new Ped(o); this.list.push(p); return p; }

    update(dt) {
      const G = this.G;
      for (const p of this.list) {
        if (p.done) continue;
        const tgt = p.path[p.pi];
        if (!tgt) { p.done = true; if (p.onArrive) p.onArrive(p); continue; }
        // waiting for permission to step off the curb
        if (p.pi === p.waitAt && p.canGo && !p.canGo(p)) { p.v = 0; p.waiting = true; }
        else if (p.hold && p.hold(p) && p.pi >= (p.holdIdx || 0)) { p.v = 0; }
        else {
          p.waiting = false;
          const dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy);
          const step = p.speed * dt;
          // do not walk into the player's car
          const P = G.player;
          const nx = p.x + (dx / (d || 1)) * Math.min(step, d), ny = p.y + (dy / (d || 1)) * Math.min(step, d);
          const pl = U.toLocal(nx, ny, P.x, P.y, P.h);
          if (Math.abs(pl.f) < P.len / 2 + 0.4 && Math.abs(pl.r) < P.wid / 2 + 0.4 && (p.blockT = (p.blockT || 0) + dt) < 3) { p.v = 0; }
          else {
            if (p.blockT > 3) p.blockT = 0; // squeezed around the car
            if (d <= step) { p.x = tgt.x; p.y = tgt.y; p.pi++; }
            else { p.x = nx; p.y = ny; }
            p.h = Math.atan2(dy, dx);
            p.v = p.speed;
            p.phase += dt * p.speed * 5;
          }
        }
        p.onRoad = this.isOnRoad(p.x, p.y);
      }
      this.list = this.list.filter((p) => !p.done);
      this.maintain(dt);
    }

    isOnRoad(x, y) {
      for (const n of this.net.nodes) {
        if (n.ring) { const d = Math.hypot(x - n.x, y - n.y); if (d < n.ring.r1 && d > n.ring.r0) return true; }
        else if (x >= n.box.x0 && x <= n.box.x1 && y >= n.box.y0 && y <= n.box.y1) return true;
      }
      for (const r of this.net.roads) {
        const st = r.toST(x, y);
        if (st.s >= r.a0 && st.s <= r.a1 && st.u > r.uMin && st.u < r.uMax) return true;
      }
      return false;
    }

    // a pedestrian is crossing on the crosswalk across arm k of node
    crosswalkBusy(node, k) {
      for (const p of this.list) if (p.cw && p.cw.node === node && p.cw.k === k && p.onRoad && !p.waiting) return true;
      return false;
    }
    crosswalkPeds(node, k) { return this.list.filter((p) => p.cw && p.cw.node === node && p.cw.k === k && p.onRoad && !p.waiting); }
    crossingOccupied(f) {
      for (const p of this.list) if (p.feature === f && p.onRoad) return true;
      return false;
    }

    // ---------------- spawners ----------------
    maintain(dt) {
      const G = this.G, sc = G.scenario;
      this.timer -= dt;
      if (this.timer > 0) return;
      this.timer = 0.7;
      const want = sc.traffic.peds || 0;
      const cur = this.list.filter((p) => p.role === 'xwalk').length;
      if (cur < want) this.spawnCrosswalkPed();
    }

    spawnCrosswalkPed(node, k, fromA) {
      const G = this.G, P = G.player;
      if (!node) {
        const cands = this.net.nodes.filter((n) => n.crosswalk && Math.hypot(n.x - P.x, n.y - P.y) < 200);
        if (!cands.length) return null;
        node = U.pick(cands);
        const arms = [0, 1, 2, 3].filter((i) => node.arms[i]);
        k = U.pick(arms);
      }
      const cw = this.net.crosswalk(node, k);
      if (!cw) return null;
      if (fromA === undefined) fromA = Math.random() < 0.5;
      const a = fromA ? cw.a : cw.b, b = fromA ? cw.b : cw.a;
      const arm = node.arms[k], dv = DS.ARM_VEC[k];
      const back = U.rand(6, 25);
      const start = { x: a.x + dv.x * back, y: a.y + dv.y * back };
      const away = U.rand(10, 30), sideSign = Math.random() < 0.5 ? 1 : -1;
      // after crossing, continue along the sidewalk (either outward along the arm or around the corner)
      const end = sideSign > 0 ? { x: b.x + dv.x * away, y: b.y + dv.y * away } : { x: b.x + (b.x - a.x) / Math.hypot(b.x - a.x, b.y - a.y) * away * 0.6, y: b.y + (b.y - a.y) / Math.hypot(b.x - a.x, b.y - a.y) * away * 0.6 };
      const net = this.net;
      const self = this;
      return this.add({
        role: 'xwalk', cw, path: [start, a, b, end], waitAt: 2, kid: Math.random() < 0.08,
        canGo: () => {
          if (node.control === 'signal') return net.walk(node, k);
          return self.gapClear(cw, 3.2);
        },
      });
    }

    // no vehicle (incl. player) will reach the crossing within `ttc` seconds
    gapClear(cw, ttc) {
      const G = this.G;
      const cx = (cw.a.x + cw.b.x) / 2, cy = (cw.a.y + cw.b.y) / 2;
      const ents = G.traffic.vehicles.concat([G.player]);
      for (const o of ents) {
        if (o.kind === 'bike') continue;
        const d = Math.hypot(o.x - cx, o.y - cy);
        if (d > 70) continue;
        const toward = ((cx - o.x) * Math.cos(o.h) + (cy - o.y) * Math.sin(o.h)) / (d || 1);
        if (d < 9 && Math.abs(o.v) > 0.5) return false;
        if (toward > 0.3 && Math.abs(o.v) > 1 && (d - 6) / Math.abs(o.v) < ttc) return false;
      }
      return true;
    }

    // PXO / school crossing pedestrian (or group of children)
    spawnFeatureCrossing(f, opts = {}) {
      const r = f.road;
      const fromLow = opts.fromLow !== undefined ? opts.fromLow : Math.random() < 0.5;
      const uA = fromLow ? r.uMin - 1.8 : r.uMax + 1.8, uB = fromLow ? r.uMax + 1.8 : r.uMin - 1.8;
      const n = opts.count || 1;
      const out = [];
      const self = this;
      for (let i = 0; i < n; i++) {
        const ds = (i - (n - 1) / 2) * 0.9;
        const a = r.toXY(f.s + ds, uA), b = r.toXY(f.s + ds, uB);
        const back = r.toXY(f.s + ds + (Math.random() < 0.5 ? 1 : -1) * U.rand(5, 12), uA + (fromLow ? -0.5 : 0.5));
        const end = r.toXY(f.s + ds + U.rand(8, 20), uB + (fromLow ? 0.6 : -0.6));
        out.push(this.add({
          role: 'feature', feature: f, kid: !!opts.kid, speed: opts.kid ? U.rand(1.0, 1.25) : U.rand(1.1, 1.35),
          path: opts.noApproach ? [a, b, end] : [back, a, b, end], waitAt: opts.noApproach ? 1 : 2,
          canGo: () => {
            if (opts.guard && !opts.guard.ready) return false;
            // pedestrians step out once approaching vehicles can still stop (or have stopped)
            return self.featureGap(f, opts.guard ? 2.0 : 3.5);
          },
        }));
      }
      f.active = true;
      return out;
    }
    featureGap(f, ttc) {
      const r = f.road;
      const G = this.G;
      const ents = G.traffic.vehicles.concat([G.player]);
      for (const o of ents) {
        if (o.kind === 'bike') continue;
        const st = r.toST(o.x, o.y);
        if (st.u < r.uMin - 1 || st.u > r.uMax + 1) continue;
        const d = Math.abs(st.s - f.s);
        if (d > 80) continue;
        const dirv = r.dirVec(1);
        const vAlong = Math.abs(o.v) * (Math.cos(o.h) * dirv.x + Math.sin(o.h) * dirv.y);
        const toward = (f.s - st.s) * vAlong > 0;
        if (d < 7 && Math.abs(o.v) > 0.3) return false;
        if (toward && Math.abs(vAlong) > 1.5 && (d - 8) / Math.abs(vAlong) < ttc) return false;
      }
      return true;
    }

    // crossing guard routine at a school crossing feature
    spawnGuardRoutine(f, kids) {
      const r = f.road, self = this;
      const curbU = r.uMax + 1.8, midU = (r.uMax + r.uMin) / 2;
      const home = r.toXY(f.s - 2.2, curbU), mid = r.toXY(f.s - 2.2, midU);
      const guard = { ready: false };
      const g = this.add({
        role: 'guard', feature: f, sign: true, color: 0xff6a00, speed: 1.2, path: [home, home, mid, mid, home],
        waitAt: 1,
        canGo: () => self.featureGap(f, 2.6),
      });
      g.isGuard = true;
      g.hold = (p) => {
        // stay in the middle while children are on the road
        if (p.pi === 3) {
          guard.ready = true;
          const kidsOn = self.list.some((k) => k.feature === f && !k.isGuard && (k.onRoad || k.pi <= 2));
          return kidsOn;
        }
        return false;
      };
      g.holdIdx = 3;
      this.spawnFeatureCrossing(f, { count: kids || 4, kid: true, fromLow: false, guard, noApproach: false });
      return g;
    }

    // streetcar passengers: board and alight across the curb lane
    streetcarStop(sc) {
      const seg = sc.seg, r = seg.road, d = seg.dir;
      const sFront = seg.sStart + d * sc.s + d * (sc.len / 2);
      const qCurb = r.qCurb(d) + (r.bike ? C.BIKE_W : 0) + 1.4;
      const peds = [];
      const doors = [-4, -13, -22];
      const nBoard = U.randInt(2, 4), nAlight = U.randInt(1, 3);
      for (let i = 0; i < nBoard; i++) {
        const sd = sFront + d * U.pick(doors) + d * U.rand(-1, 1);
        const a = r.toXY(sd + d * U.rand(-6, 6), d * qCurb), b = r.toXY(sd, d * qCurb), c = r.toXY(sd, seg.u + d * 1.4);
        const p = this.add({ role: 'board', path: [a, b, c], waitAt: 2, canGo: () => sc.doorsOpen && this.boardGap(sc, b), speed: U.rand(1.2, 1.6) });
        p.streetcar = sc; peds.push(p);
      }
      for (let i = 0; i < nAlight; i++) {
        const sd = sFront + d * U.pick(doors);
        const a = r.toXY(sd, seg.u + d * 1.4), b = r.toXY(sd + d * U.rand(-1.5, 1.5), d * qCurb), c = r.toXY(sd + d * U.rand(-15, 15), d * (qCurb + 0.8));
        const p = this.add({ role: 'alight', path: [a, a, b, c], waitAt: 1, canGo: () => sc.doorsOpen && this.boardGap(sc, a), speed: U.rand(1.2, 1.6) });
        p.streetcar = sc; peds.push(p);
      }
      return peds;
    }
    boardGap(sc, pt) {
      // passengers wait if a vehicle is right beside them in the curb lane
      const G = this.G;
      for (const o of G.traffic.vehicles.concat([G.player])) {
        if (o === sc) continue;
        if (Math.hypot(o.x - pt.x, o.y - pt.y) < 6 && Math.abs(o.v) > 1) return false;
      }
      return true;
    }
    streetcarPedsActive(sc) {
      return this.list.some((p) => p.streetcar === sc && (p.onRoad || (p.role === 'alight' && p.pi <= 2) || (p.role === 'board' && p.pi <= 2 && p.pi >= 1)));
    }

    // children leaving a stopped school bus cross in front of it to the far side
    schoolBusKids(bus, n) {
      const seg = bus.seg, r = seg.road, d = seg.dir;
      const sBus = seg.sStart + d * bus.s;
      const sCross = sBus + d * (bus.len / 2 + 3);
      const G = this.G;
      const far = -(r.uMax > -r.uMin ? r.uMax : -r.uMin) - 1.8;
      for (let i = 0; i < n; i++) {
        const door = r.toXY(sBus + d * (bus.len / 2 - 1.5), seg.u + d * 1.5);
        const front = r.toXY(sCross + d * i * 0.8, seg.u + d * 1.5);
        const farPt = r.toXY(sCross + d * i * 0.8, d * far);
        const end = r.toXY(sCross + d * U.rand(6, 25), d * (far - 1));
        const p = this.add({ role: 'kid', kid: true, path: [door, door, front, farPt, end], waitAt: 1, speed: U.rand(1.0, 1.3),
          canGo: (me) => bus.redFlash && G.time > me._t0 });
        p._t0 = G.time + 1.2 + i * 1.1;
        p.bus = bus;
      }
    }
    busKidsActive(bus) { return this.list.some((p) => p.bus === bus && (p.onRoad || p.pi <= 2)); }
  }

  DS.Peds = Peds;
})();
