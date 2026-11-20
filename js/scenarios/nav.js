/* Examiner route instructions + checkpoint progress + scripted scenario events. */
(function () {
  'use strict';
  const DS = window.DS, U = DS.U, C = DS.C;

  const MOVE_TEXT = { L: 'turn LEFT', R: 'turn RIGHT', S: 'go STRAIGHT', U: 'make a U-turn' };
  const ORD = ['', '1st', '2nd', '3rd', '4th'];

  const Nav = {
    init(G) {
      this.G = G;
      G.cpIndex = 0;
      G.instr = { text: '', dist: null, move: null, sub: '' };
      G.route = null;
      this.parkT = 0;
      this.firedEvents = new Set();
      this._last = null;
    },
    current() { const G = this.G; return G.scenario.checkpoints[G.cpIndex] || null; },

    update(dt) {
      const G = this.G;
      if (G.finished) return;
      const cp = this.current();
      // scripted events
      (G.scenario.events || []).forEach((ev, i) => {
        if (this.firedEvents.has(i)) return;
        try { if (ev.when(G)) { this.firedEvents.add(i); ev.run(G); } } catch (e) { console.warn('event', e); this.firedEvents.add(i); }
      });
      if (!cp) return;
      const pl = G.playerLoc, P = G.player;
      const road = cp.road ? G.net.road(cp.road) : null;
      // ---- reached? ----
      let reached = false;
      if (cp.ramp) {
        reached = pl.ramp && pl.ramp.id === cp.ramp && pl.rampS > cp.s;
      } else if (road && pl.road === road && pl.dir === cp.dir && !pl.inNode) {
        const d = (pl.s - cp.s) * cp.dir;
        if (cp.type === 'park') {
          if (Math.abs(d) < 40 && P.stoppedTime > 1.2) { this.evaluatePark(cp); reached = true; }
        } else reached = d >= 0 && d < 60;
      }
      if (reached) {
        G.cpIndex++;
        DS.Bus.emit('checkpoint', cp);
        if (cp.type === 'park' || cp.type === 'end' || G.cpIndex >= G.scenario.checkpoints.length) {
          G.completePending = 2.2;
          G.instr = { text: cp.type === 'park' ? 'Well done. Put the car in Park (P). Test complete.' : 'Route complete!', dist: null, move: 'done', sub: '' };
          return;
        }
      }
      this.instruction();
    },

    evaluatePark(cp) {
      const G = this.G, P = G.player, pl = G.playerLoc, r = pl.road;
      const q = pl.dir * pl.u;
      const curbQ = r.qCurb(pl.dir) + (r.bike ? C.BIKE_W : 0) + (r.kind !== 'highway' && !r.sidewalk ? 0.8 : 0);
      const gap = curbQ - (q + P.wid / 2);
      const st = DS.Rules.st;
      if (G.time - st.rightSignalT > 14) G.examiner.flag('PARK_SIGNAL', { once: true });
      if (G.time - P.lastShoulderR > 16) G.examiner.flag('PARK_CHECK', { once: true });
      if (gap > 0.55) G.examiner.flag('PARK_FAR', { once: true, detail: 'Distance from curb: ~' + Math.round(gap * 100) + ' cm.' });
      else G.examiner.praise('Nicely parked close to the curb (' + Math.max(0, Math.round(gap * 100)) + ' cm).', 'park');
      void cp;
    },

    instruction() {
      const G = this.G, cp = this.current(), pl = G.playerLoc, net = G.net;
      if (!cp) return;
      const road = cp.road ? net.road(cp.road) : null;
      const label = cp.label || '';
      if (cp.instr) {
        let dist = null;
        if (road && pl.road === road) dist = (cp.s - pl.s) * cp.dir;
        G.instr = { text: cp.instr, dist: dist !== null && dist > 0 ? dist : null, move: cp.move || 'S', sub: label };
        return;
      }
      if (pl.inNode && this._last) { G.instr = this._last; return; }
      // already on the target road segment
      if (road && pl.road === road && pl.dir === cp.dir) {
        const d = (cp.s - pl.s) * cp.dir;
        const nodeBetween = road.nodes.some((n) => { const ns = net.nodeS(n, road); return (ns - pl.s) * cp.dir > 0 && (cp.s - ns) * cp.dir > 0; });
        if (d > 0 && !nodeBetween) {
          G.instr = this._last = { text: cp.type === 'park' ? 'Pull over and park at the right curb' : 'Continue on ' + road.name, dist: d, move: cp.type === 'park' ? 'park' : 'S', sub: label };
          G.route = null;
          return;
        }
      }
      const ap = pl.approach;
      if (!ap) { if (this._last) G.instr = this._last; return; }
      const steps = net.route(ap.node, ap.k, { road, dir: cp.dir, s: cp.s });
      if (!steps || !steps.length) {
        G.instr = this._last = { text: 'Continue — the examiner will re-route you', dist: null, move: 'S', sub: label };
        return;
      }
      G.route = { start: ap.node, steps };
      // find first non-straight manoeuvre
      let kin = ap.k, dist = ap.distEdge, i = 0;
      for (; i < steps.length; i++) {
        const e = steps[i];
        const node = e.from;
        const mv = DS.relation(kin, e.arm);
        if (mv !== 'S' || node.ring) {
          let text;
          if (node.ring) text = 'At the roundabout, take the ' + ORD[net.roundaboutExitNumber(node, kin, e.arm)] + ' exit onto ' + e.road.name;
          else text = (i === 0 ? 'At ' + node.name + ', ' : 'Continue, then at ' + node.name + ' ') + MOVE_TEXT[mv] + ' onto ' + e.road.name;
          G.instr = this._last = { text, dist, move: node.ring ? 'ring' : mv, sub: label };
          return;
        }
        dist += e.len;
        if (e.to) kin = net.armOf(e.to, e.road, -e.dir).k;
      }
      G.instr = this._last = { text: 'Continue straight on ' + steps[0].road.name, dist: ap.distEdge, move: 'S', sub: label };
    },
  };
  DS.Nav = Nav;

  /* Helpers used by scenario scripts */
  DS.ScenarioKit = {
    on(G, road, dir, sFrom, sTo) {
      const pl = G.playerLoc;
      if (!pl.road || pl.road.name !== road || pl.dir !== dir || pl.inNode) return false;
      const d = (pl.s - sFrom) * dir;
      return d >= 0 && (sTo === undefined || (sTo - pl.s) * dir >= 0);
    },
    spawnOn(G, roadName, dir, lane, roadS, type, opts) {
      const r = G.net.road(roadName);
      const seg = G.net.segAt(r, dir, lane, roadS);
      if (!seg) return null;
      const s = (roadS - seg.sStart) * dir;
      return G.traffic.add(type, seg, U.clamp(s, 0, seg.len - 0.5), opts || {});
    },
  };
})();
