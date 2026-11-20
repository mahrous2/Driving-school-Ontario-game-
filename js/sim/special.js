/* Special vehicle behaviours: streetcars, school buses, emergency vehicles, stopped police. */
(function () {
  'use strict';
  const DS = window.DS, U = DS.U;

  const Special = {
    // ---------- TTC-style streetcar ----------
    streetcarScript(stops) {
      return {
        state: 'drive', served: new Set(), t: 0,
        update(v, dt, G) {
          const seg = v.seg;
          v.scriptStop = null;
          if (seg.conn) return;
          const sFront = seg.sStart + seg.dir * (v.s + v.len / 2);
          if (this.state === 'drive') {
            for (const st of stops) {
              if (st.road !== seg.road || st.dir !== seg.dir || this.served.has(st)) continue;
              const gap = (st.s - sFront) * seg.dir;
              if (gap < -3) { this.served.add(st); continue; }
              if (gap < 120) {
                v.scriptStop = gap;
                if (gap < 1.2 && v.v < 0.15) { this.state = 'dwell'; this.t = 0; this.stop = st; v.doorsOpen = true; G.peds.streetcarStop(v); }
              }
              break;
            }
          } else if (this.state === 'dwell') {
            v.scriptStop = 0;
            this.t += dt;
            if (this.t > 9 && !G.peds.streetcarPedsActive(v)) { v.doorsOpen = false; this.state = 'closing'; this.t = 0; }
          } else if (this.state === 'closing') {
            v.scriptStop = 0;
            this.t += dt;
            if (this.t > 1.6) { this.state = 'drive'; this.served.add(this.stop); }
          }
        },
        onSeg() { this.served.clear(); },
      };
    },

    // ---------- school bus that stops to unload children ----------
    schoolBusScript(stopRoadS, opts = {}) {
      return {
        state: 'drive', t: 0,
        update(v, dt, G) {
          const seg = v.seg;
          v.scriptStop = null;
          if (seg.conn) return;
          const sFront = seg.sStart + seg.dir * (v.s + v.len / 2);
          const gap = (stopRoadS - sFront) * seg.dir;
          if (this.state === 'drive') {
            if (gap < 90 && gap > -2) {
              v.scriptStop = gap;
              if (gap < 60) v.amberFlash = true; // amber warning lights before stopping
              if (gap < 30) v.latTarget = 0.5;
              if (gap < 1.0 && v.v < 0.1) { this.state = 'load'; this.t = 0; v.amberFlash = false; v.redFlash = true; v.stopArm = true; G.peds.schoolBusKids(v, opts.kids || 3); DS.Bus.emit('schoolBusStopped', v); }
            }
          } else if (this.state === 'load') {
            v.scriptStop = 0;
            this.t += dt;
            if (this.t > (opts.minTime || 10) && !G.peds.busKidsActive(v)) { this.state = 'leave'; this.t = 0; v.redFlash = false; v.stopArm = false; v.latTarget = 0; }
          } else if (this.state === 'leave') {
            this.t += dt;
            if (this.t < 1.5) v.scriptStop = 0;
          }
        },
      };
    },

    // ---------- moving emergency vehicle with lights and siren ----------
    emergencyScript() {
      return {
        update(v, dt, G) {
          // move toward the centre line to pass vehicles that pulled over
          let blocked = false;
          for (const o of G.traffic.vehicles.concat([G.player])) {
            if (o === v || o.kind === 'bike') continue;
            const rel = U.toLocal(o.x, o.y, v.x, v.y, v.h);
            if (rel.f > 0 && rel.f < 45 && Math.abs(rel.r) < 4.5) { blocked = true; break; }
          }
          const r = v.seg.road;
          if (r && r.kind === 'highway') v.latTarget = 0;
          else v.latTarget = blocked && !v.seg.conn ? -1.7 : 0;
        },
      };
    },

    spawnEmergencyBehind(G, type, back) {
      const pl = G.playerLoc, net = G.net;
      if (!pl || !pl.road || pl.inNode) return null;
      const r = pl.road, dir = pl.dir;
      let lane = pl.laneInfo && pl.laneInfo.kind === 'lane' ? pl.laneInfo.lane : 0;
      if (r.kind === 'highway') lane = 0;
      let sSpawn = pl.s - dir * (back || 130);
      sSpawn = U.clamp(sSpawn, r.a0 + 5, r.a1 - 5);
      const seg = net.segAt(r, dir, lane, sSpawn);
      if (!seg) return null;
      const s = (sSpawn - seg.sStart) * dir;
      if (s < 0 || s > seg.len) return null;
      const lim = r.limit;
      const ev = G.traffic.add(type || 'ambulance', seg, s, { v: (lim + 15) / 3.6, script: Special.emergencyScript(), fixedRoute: ['S', 'S', 'S', 'S'] });
      ev.keep = true;
      ev.siren = true;
      setTimeout(() => { ev.keep = false; }, 60000);
      return ev;
    },

    placeStaticPolice(G, roadName, dir, lane, roadS, latOff) {
      const r = G.net.road(roadName);
      const seg = G.net.segAt(r, dir, lane, roadS);
      if (!seg) return null;
      const s = (roadS - seg.sStart) * dir;
      const v = G.traffic.add('police', seg, s, { static: true, lightsOn: true, emergency: false });
      v.latOff = v.latTarget = latOff;
      v.keep = true;
      v.staticEmergency = true;
      v.updatePose();
      return v;
    },
  };
  DS.Special = Special;
})();
