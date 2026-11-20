/* Builds the static 3D world from the road network: roads, markings, sidewalks, intersections,
 * roundabouts, ramps, signals, signs, buildings, trees, street lamps, snowbanks and black ice.
 */
(function () {
  'use strict';
  const DS = window.DS, U = DS.U, C = DS.C;
  const ARM = DS.ARM_VEC;

  const COL = {
    asphalt: 0xffffff, asphaltNode: 0xf0f0f0, white: 0xf2f2f2, yellow: 0xf3c200, green: 0x3d9a52, sidewalk: 0xb9b6ae,
    curb: 0xcfcac0, grass: 0x5d8a3a, gravel: 0x8c8475, track: 0x6e6e6e, island: 0x4f7d35,
  };

  // Instanced object collector
  class Inst {
    constructor(geo, mat) { this.geo = geo; this.mat = mat; this.items = []; }
    add(x, y, z, ry, sx, sy, sz, color) { this.items.push({ x, y, z, ry: ry || 0, sx: sx || 1, sy: sy || 1, sz: sz || 1, color }); return this.items.length - 1; }
    build() {
      if (!this.items.length) return null;
      const m = new THREE.InstancedMesh(this.geo, this.mat, this.items.length);
      const o = new THREE.Object3D();
      this.items.forEach((it, i) => {
        o.position.set(it.x, it.y, it.z); o.rotation.set(0, it.ry, 0); o.scale.set(it.sx, it.sy, it.sz); o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
        if (it.color !== undefined) m.setColorAt(i, new THREE.Color(it.color));
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.mesh = m;
      return m;
    }
  }

  function facingRot(fx, fy) { return Math.atan2(fx, -fy); } // rotation.y so a +Z-facing plane faces world dir (fx,fy)

  const World3D = {
    build(G, scene) {
      const net = G.net, sc = G.scenario, winter = G.weather === 'snow';
      const style = sc.style || 'suburban';
      const root = new THREE.Group();
      const out = { group: root, obstacles: [], iceRects: [], signalLamps: [], beacons: [], lampHeads: null, glows: null, windowsMat: null };
      const rng = U.rng(sc.seed || 7);

      // ---------- materials ----------
      const asphaltTex = DS.Tex.get('asphalt', winter ? 1 : 0);
      const roadMat = new THREE.MeshLambertMaterial({ map: asphaltTex, vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const markMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const winTex = DS.Tex.get('windows', 0);
      const bldMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: winTex, emissive: 0x000000, emissiveMap: DS.Tex.get('windows', 1) });
      out.windowsMat = bldMat;

      const roadB = new DS.GeoBatch(), markB = new DS.GeoBatch(), swB = new DS.GeoBatch(), bldB = new DS.GeoBatch(), roofB = new DS.GeoBatch();
      const H = { road: 0.02, node: 0.022, mark: 0.04 };

      // ground
      const groundCol = winter ? 0xe9eef2 : style === 'rural' ? 0x6f9a45 : COL.grass;
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshLambertMaterial({ color: groundCol }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.12; root.add(ground);

      const poles = new Inst(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), new THREE.MeshLambertMaterial({ color: 0x8a8d91 }));
      const darkBox = new Inst(DS.Models.unitBox, new THREE.MeshLambertMaterial({ color: 0x222426 }));
      const yellowBox = new Inst(DS.Models.unitBox, new THREE.MeshLambertMaterial({ color: 0xd9a400 }));
      const lampInst = new Inst(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const signBack = new Inst(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }));
      const signs = new Map();
      const addSign = (key, arg, x, y, h, fx, fy, w, hgt, noPole) => {
        const k = key + ':' + (arg === undefined ? '' : arg);
        if (!signs.has(k)) signs.set(k, new Inst(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ map: DS.Tex.get(key, arg), transparent: true, alphaTest: 0.3 })));
        const ry = facingRot(fx, fy);
        signs.get(k).add(x + fx * 0.04, h, -(y + fy * 0.04), ry, w, hgt, 1);
        signBack.add(x, h, -y, ry + Math.PI, w * 0.96, hgt * 0.96, 1);
        if (!noPole) poles.add(x, h / 2, -y, 0, 1, h, 1);
      };

      // ---------- roads ----------
      for (const r of net.roads) {
        const len = r.a1 - r.a0, mid = (r.a0 + r.a1) / 2;
        const hd = r.axis === 'h' ? 0 : Math.PI / 2;
        // asphalt (between uMin..uMax)
        const uc = (r.uMin + r.uMax) / 2;
        const pc = r.toXY(mid, uc);
        roadB.ground(pc.x, pc.y, len, r.uMax - r.uMin, hd, H.road, COL.asphalt);
        // aux lanes (acceleration / deceleration) + tapers
        for (const a of r.aux) {
          const q0 = a.dir * (r.uMax), w = r.laneW;
          const uA = a.dir > 0 ? r.uMax + w / 2 : r.uMin - w / 2;
          const p = r.toXY((a.s0 + a.s1) / 2, uA);
          roadB.ground(p.x, p.y, Math.abs(a.s1 - a.s0), w, hd, H.road, COL.asphalt);
          // taper beyond the end (accel) or before the start (decel)
          const sT = a.kind === 'accel' ? a.s1 : a.s0, sT2 = a.kind === 'accel' ? a.s1 + a.dir * 70 : a.s0 - a.dir * 70;
          const edgeU = a.dir > 0 ? r.uMax : r.uMin;
          roadB.groundPoly([r.toXY(sT, edgeU), r.toXY(sT, edgeU + a.dir * w), r.toXY(sT2, edgeU)], H.road, COL.asphalt);
          // lane line between aux lane and right lane: solid near gore, dashed elsewhere
          const qLine = r.qCurb(a.dir);
          const uLine = a.dir * qLine;
          const solidTo = a.kind === 'accel' ? (a.solidEnd || a.s0) : a.s1, solidFrom = a.kind === 'accel' ? a.s0 : (a.solidStart || a.s1);
          this.dashLine(markB, r, uLine, a.s0, a.s1, 0.2, COL.white, a.kind === 'accel' ? [a.s0, solidTo] : [solidFrom, a.s1], 3, 6);
          // right edge line of aux lane
          this.dashLine(markB, r, uLine + a.dir * (w), Math.min(a.s0, a.s1), Math.max(a.s0, a.s1), 0.15, COL.white, null, 0, 0);
          void q0;
        }
        // shoulders on rural roads (gravel)
        if (!r.sidewalk && r.kind !== 'highway') {
          for (const sgn of [1, -1]) {
            const u = sgn > 0 ? r.uMax + 0.8 : r.uMin - 0.8;
            const p = r.toXY(mid, u);
            roadB.ground(p.x, p.y, len, 1.6, hd, H.road - 0.004, winter ? 0xb4bac1 : COL.gravel);
          }
        }
        // sidewalks (cut at intersections)
        if (r.sidewalk) {
          const cuts = r.nodes.map((n) => [net.edgeS(n, r, -1, 0), net.edgeS(n, r, 1, 0)]);
          const spans = []; let s = r.a0;
          for (const [c0, c1] of cuts) { if (c0 > s) spans.push([s, c0]); s = Math.max(s, c1); }
          if (r.a1 > s) spans.push([s, r.a1]);
          for (const [s0, s1] of spans) {
            for (const sgn of [1, -1]) {
              const u = sgn > 0 ? r.uMax + C.SIDEWALK_W / 2 : r.uMin - C.SIDEWALK_W / 2;
              const p = r.toXY((s0 + s1) / 2, u);
              const sx = r.axis === 'h' ? s1 - s0 : C.SIDEWALK_W, sz = r.axis === 'h' ? C.SIDEWALK_W : s1 - s0;
              swB.box(p.x, 0.075, -p.y, sx, 0.15, sz, winter ? 0xdfe3e6 : COL.sidewalk);
              if (winter) {
                // snowbank along the curb
                const ub = sgn > 0 ? r.uMax + 0.35 : r.uMin - 0.35;
                const pb = r.toXY((s0 + s1) / 2, ub);
                const bl = Math.max(0, s1 - s0 - 8);
                swB.box(pb.x, 0.3, -pb.y, r.axis === 'h' ? bl : 0.6, 0.35, r.axis === 'h' ? 0.6 : bl, 0xf7fafc);
              }
            }
          }
        }
        // lane markings between nodes
        const spans = []; let s = r.a0;
        for (const n of r.nodes) {
          const c0 = net.edgeS(n, r, -1, 0) - (n.crosswalk ? C.CW_W : 0), c1 = net.edgeS(n, r, 1, 0) + (n.crosswalk ? C.CW_W : 0);
          if (c0 > s) spans.push([s, c0]); s = Math.max(s, c1);
        }
        if (r.a1 > s) spans.push([s, r.a1]);
        for (const [s0, s1] of spans) {
          if (r.oneway === 0) {
            if (r.median > 0) {
              for (const sgn of [1, -1]) this.dashLine(markB, r, sgn * (r.median / 2 + 0.15), s0, s1, 0.15, COL.yellow, null, 0, 0);
            } else {
              for (const off of [-0.11, 0.11]) this.dashLine(markB, r, off, s0, s1, 0.1, COL.yellow, null, 0, 0);
            }
          }
          for (const dir of [1, -1]) {
            const n = r.n(dir);
            if (!n) continue;
            for (let i = 1; i < n; i++) {
              const u = dir * (r.qLeft(dir) + i * r.laneW);
              this.dashLine(markB, r, u, s0, s1, 0.13, COL.white, null, 3, r.kind === 'highway' ? 9 : 6);
            }
            if (r.bike) {
              const u = dir * r.qCurb(dir);
              this.dashLine(markB, r, u, s0, s1, 0.18, COL.white, null, 0, 0);
              // green conflict zones approaching intersections
              const bu = r.bikeU(dir);
              for (const n2 of r.nodes) {
                const e = net.edgeS(n2, r, -dir, 0);
                const sA = e - dir * (C.CW_W + 18), sB = e - dir * C.CW_W;
                if ((sA - s0) * (s1 - sA) >= 0 || true) {
                  const lo = Math.min(sA, sB), hi = Math.max(sA, sB);
                  if (lo >= s0 - 1 && hi <= s1 + 1) { const p = r.toXY((lo + hi) / 2, bu); markB.ground(p.x, p.y, hi - lo, C.BIKE_W - 0.2, hd, H.mark - 0.005, COL.green); }
                }
              }
            }
            if (r.kind === 'highway' || r.rural) {
              const uEdge = dir * (r.qCurb(dir) + 0.1);
              this.dashLine(markB, r, uEdge, s0, s1, 0.15, COL.white, null, 0, 0);
            }
            if (r.oneway !== 0) {
              const uL = dir * (r.qLeft(dir) + 0.15);
              if (r.kind === 'highway') this.dashLine(markB, r, uL, s0, s1, 0.15, COL.yellow, null, 0, 0);
            }
          }
        }
        // streetcar tracks (lane 0 both directions), continuous through intersections
        if (r.streetcar) {
          for (const dir of [1, -1]) {
            if (!r.n(dir)) continue;
            const u0 = r.laneU(dir, 0);
            for (const off of [-0.72, 0.72]) {
              const p = r.toXY(mid, u0 + off);
              markB.ground(p.x, p.y, len, 0.09, hd, H.mark + 0.004, COL.track);
            }
          }
        }
        // highway barriers
        if (r.kind === 'highway') {
          if (r.median > 0) {
            const p = r.toXY(mid, 0);
            swB.box(p.x, 0.45, -p.y, r.axis === 'h' ? len : 0.6, 0.9, r.axis === 'h' ? 0.6 : len, 0xc9c6bd);
            out.obstacles.push(this.rectXY(r, r.a0, r.a1, -0.3, 0.3));
          }
          // guardrails beyond shoulders, gaps where aux lanes / ramps connect
          for (const dir of [1, -1]) {
            if (!r.n(dir)) continue;
            const qEdge = r.qCurb(dir) + r.shoulder + 0.6;
            const gaps = r.aux.filter((a) => a.dir === dir).map((a) => [Math.min(a.s0, a.s1) - 140, Math.max(a.s0, a.s1) + 140]);
            let s2 = r.a0; const rails = [];
            for (const [g0, g1] of gaps.sort((a, b) => a[0] - b[0])) { if (g0 > s2) rails.push([s2, g0]); s2 = Math.max(s2, g1); }
            if (r.a1 > s2) rails.push([s2, r.a1]);
            for (const [r0, r1] of rails) {
              const p = r.toXY((r0 + r1) / 2, dir * qEdge);
              swB.box(p.x, 0.6, -p.y, r.axis === 'h' ? r1 - r0 : 0.2, 0.3, r.axis === 'h' ? 0.2 : r1 - r0, 0xb8bcc2);
              out.obstacles.push(this.rectXY(r, r0, r1, dir * qEdge - 0.1, dir * qEdge + 0.1));
            }
          }
        }
      }

      // ---------- intersections ----------
      for (const n of net.nodes) {
        if (n.ring) {
          const ring = new THREE.Mesh(new THREE.RingGeometry(n.ring.r0, n.ring.r1 + 0.5, 48, 1), roadMat.clone());
          ring.material.vertexColors = false; ring.material.color = new THREE.Color(0xffffff);
          ring.rotation.x = -Math.PI / 2; ring.position.set(n.x, H.node + 0.003, -n.y); root.add(ring);
          const island = new THREE.Mesh(new THREE.CylinderGeometry(n.ring.r0, n.ring.r0 + 0.2, 0.3, 40), new THREE.MeshLambertMaterial({ color: winter ? 0xf0f4f6 : COL.island }));
          island.position.set(n.x, 0.15, -n.y); root.add(island);
          const apron = new THREE.Mesh(new THREE.RingGeometry(n.ring.r0, n.ring.r0 + 1.6, 40, 1), new THREE.MeshLambertMaterial({ color: 0xa39a8a, side: THREE.DoubleSide }));
          apron.rotation.x = -Math.PI / 2; apron.position.set(n.x, H.node + 0.01, -n.y); root.add(apron);
          // decorative trees on the island
          for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.5; this.tree(G, root, n.x + Math.cos(a) * n.ring.r0 * 0.45, n.y + Math.sin(a) * n.ring.r0 * 0.45, rng, winter, out); }
          // yield lines and signs on every entry
          for (const arm of n.arms) {
            if (!arm || !arm.road.n(arm.dirIn)) continue;
            const r = arm.road, dir = arm.dirIn;
            const hd = r.heading(dir);
            for (let i = 0; i < r.n(dir); i++) {
              const u = r.laneU(dir, i);
              const sE = net.edgeS(n, r, -dir, u) - dir * 0.6;
              for (let t = -1.4; t <= 1.4; t += 0.7) { const p = r.toXY(sE, u + t); markB.ground(p.x, p.y, 0.45, 0.35, hd, H.mark, COL.white); }
            }
            const qs = r.qCurb(dir) + 1.4;
            const sS = net.edgeS(n, r, -dir, 0) - dir * 2.5;
            const p = r.toXY(sS, dir * qs), f = r.dirVec(-dir);
            addSign('yield', undefined, p.x, p.y, 2.3, f.x, f.y, 0.9, 0.9);
            const p2 = r.toXY(sS - dir * 70, dir * qs);
            addSign('roundabout', undefined, p2.x, p2.y, 2.3, f.x, f.y, 1.1, 1.1);
          }
          continue;
        }
        const b = n.box;
        roadB.ground((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.x1 - b.x0, b.y1 - b.y0, 0, H.node, COL.asphaltNode);
        for (let k = 0; k < 4; k++) {
          const arm = n.arms[k];
          if (!arm) continue;
          const r = arm.road, hd = r.heading(1);
          // crosswalk ladder stripes
          if (n.crosswalk) {
            const cw = net.crosswalk(n, k);
            for (let u = r.uMin + 0.4; u < r.uMax - 0.2; u += 1.1) {
              const p = r.toXY(cw.sMid, u);
              markB.ground(p.x, p.y, C.CW_W - 0.3, 0.55, hd, H.mark, COL.white);
            }
          }
          // stop line for inbound lanes
          const dir = arm.dirIn;
          if (r.n(dir) && n.control !== 'none' && (n.control === 'signal' || n.stopArms.has(k))) {
            const sL = net.edgeS(n, r, -dir, 0) - dir * ((n.crosswalk ? C.CW_W : 0) + C.STOP_GAP * 0.5);
            const q0 = r.qLeft(dir), q1 = r.qCurb(dir);
            const p = r.toXY(sL, dir * (q0 + q1) / 2);
            markB.ground(p.x, p.y, 0.45, q1 - q0, hd, H.mark, COL.white);
          }
          // signs & signals for inbound approach
          if (!r.n(dir)) continue;
          const f = r.dirVec(-dir);
          const qSide = r.qCurb(dir) + (r.bike ? C.BIKE_W : 0) + (r.sidewalk ? 1.2 : 1.6);
          const sStop = net.edgeS(n, r, -dir, 0) - dir * ((n.crosswalk ? C.CW_W : 0) + 1.2);
          if (n.stopArms.has(k) && (n.control === 'stop4' || n.control === 'stop2')) {
            const p = r.toXY(sStop, dir * qSide);
            addSign('stop', undefined, p.x, p.y, 2.2, f.x, f.y, 0.75, 0.75);
            if (n.control === 'stop4') addSign('allway', undefined, p.x, p.y, 1.62, f.x, f.y, 0.62, 0.2, true);
          }
          if (n.rtorBan.has(k)) {
            const p = r.toXY(sStop + dir * 0.4, dir * qSide);
            addSign('nrtor', undefined, p.x, p.y, 2.6, f.x, f.y, 0.6, 0.8);
          }
          if (n.control === 'signal') this.signalHeads(net, n, k, arm, out, poles, darkBox, lampInst, yellowBox);
        }
        // one-way signs facing cross traffic
        for (const r of [n.h, n.v]) {
          if (r.oneway === 0) continue;
          const other = r === n.h ? n.v : n.h;
          const owd = r.dirVec(r.oneway);
          for (const dir of [1, -1]) {
            if (!other.n(dir) || !net.armOf(n, other, -dir)) continue;
            const F = other.dirVec(dir);
            const far = net.edgeS(n, other, dir, 0) + dir * 1.5;
            const q = other.qCurb(dir) + (other.bike ? C.BIKE_W : 0) + 1.0;
            const p = other.toXY(far, dir * q);
            const right = U.rightOf(F.x, F.y);
            const arrowRight = owd.x * right.x + owd.y * right.y > 0;
            addSign('oneway', arrowRight ? 1 : -1, p.x, p.y, 2.9, -F.x, -F.y, 0.9, 0.34);
          }
        }
      }

      // ---------- ramps ----------
      for (const rp of net.ramps) {
        roadB.ribbon(rp.pts, rp.width + 2.4, H.road - 0.002, COL.asphalt);
        markB.ribbon(rp.pts, 0.15, H.mark, COL.white, rp.width / 2);
        markB.ribbon(rp.pts, 0.15, H.mark, COL.yellow, -rp.width / 2);
      }

      // ---------- features ----------
      for (const f of net.features) {
        const r = f.road;
        if (!r) continue;
        const hd = r.heading(1);
        if (f.type === 'pxo' || f.type === 'schoolCrossing') {
          for (let u = r.uMin + 0.3; u < r.uMax - 0.2; u += 1.0) { const p = r.toXY(f.s, u); markB.ground(p.x, p.y, 3.0, 0.5, hd, H.mark, COL.white); }
          for (const dir of [1, -1]) {
            if (!r.n(dir)) continue;
            const sL = f.s - dir * 4.5, q0 = r.qLeft(dir), q1 = r.qCurb(dir);
            const p = r.toXY(sL, dir * (q0 + q1) / 2);
            markB.ground(p.x, p.y, 0.4, q1 - q0, hd, H.mark, COL.white);
            const fv = r.dirVec(-dir);
            const qs = r.qCurb(dir) + (r.bike ? C.BIKE_W : 0) + 1.1;
            const ps = r.toXY(f.s - dir * 1.8, dir * qs);
            if (f.type === 'pxo') {
              addSign('pxo', undefined, ps.x, ps.y, 2.9, fv.x, fv.y, 0.75, 0.75);
              addSign('pxoText', undefined, ps.x, ps.y, 2.15, fv.x, fv.y, 0.75, 0.38, true);
              const bi = lampInst.add(ps.x, 3.55, -ps.y, 0, 1.3, 1.3, 1.3, 0x332200);
              out.beacons.push({ idx: bi, kind: 'pxo', f, phase: 0 });
              // overhead X sign
              const po = r.toXY(f.s - dir * 1.6, dir * (q0 + q1) / 2);
              addSign('pxo', undefined, po.x, po.y, 5.6, fv.x, fv.y, 0.9, 0.9, true);
              const bo = lampInst.add(po.x + fv.x * 0.1, 6.25, -(po.y + fv.y * 0.1), 0, 1.4, 1.4, 1.4, 0x332200);
              out.beacons.push({ idx: bo, kind: 'pxo', f, phase: 1 });
            } else {
              addSign('school', undefined, ps.x, ps.y, 2.4, fv.x, fv.y, 0.75, 0.94);
            }
          }
          if (f.type === 'pxo') {
            // overhead span wire
            const pa = r.toXY(f.s, r.uMin - 1), pb = r.toXY(f.s, r.uMax + 1);
            poles.add(pa.x, 3.2, -pa.y, 0, 1.2, 6.4, 1.2); poles.add(pb.x, 3.2, -pb.y, 0, 1.2, 6.4, 1.2);
            const pm = r.toXY(f.s, (r.uMin + r.uMax) / 2);
            darkBox.add(pm.x, 6.3, -pm.y, r.axis === 'h' ? 0 : Math.PI / 2, 0.06, 0.06, r.uMax - r.uMin + 2);
          }
        }
        if (f.type === 'schoolZone') {
          for (const dir of [1, -1]) {
            if (!r.n(dir)) continue;
            const sEnter = dir > 0 ? f.s0 : f.s1;
            const qs = r.qCurb(dir) + (r.bike ? C.BIKE_W : 0) + 1.2;
            const p = r.toXY(sEnter, dir * qs), fv = r.dirVec(-dir);
            addSign('school', undefined, p.x, p.y, 2.3, fv.x, fv.y, 0.8, 1.0);
            const b1 = lampInst.add(p.x - (fv.y) * 0.3, 3.15, -(p.y + fv.x * 0.3), 0, 1.2, 1.2, 1.2, 0x332200);
            const b2 = lampInst.add(p.x + (fv.y) * 0.3, 3.15, -(p.y - fv.x * 0.3), 0, 1.2, 1.2, 1.2, 0x332200);
            out.beacons.push({ idx: b1, kind: 'school', phase: 0 }, { idx: b2, kind: 'school', phase: 1 });
            const sExit = dir > 0 ? f.s1 : f.s0;
            const pe = r.toXY(sExit, dir * qs);
            addSign('speed', r.limit, pe.x, pe.y, 2.3, fv.x, fv.y, 0.6, 0.8);
          }
        }
        if (f.type === 'streetcarStop') {
          const qs = r.qCurb(f.dir) + (r.bike ? C.BIKE_W : 0) + 1.3;
          const p = r.toXY(f.s, f.dir * qs), fv = r.dirVec(-f.dir);
          addSign('streetcar', undefined, p.x, p.y, 2.6, fv.x, fv.y, 0.5, 0.75);
          // shelter
          const ps = r.toXY(f.s - f.dir * 8, f.dir * (qs + 1.0));
          darkBox.add(ps.x, 1.25, -ps.y, r.axis === 'h' ? 0 : Math.PI / 2, 4, 0.08, 1.4);
          darkBox.add(ps.x, 2.4, -ps.y, r.axis === 'h' ? 0 : Math.PI / 2, 4.2, 0.08, 1.6);
        }
        if (f.type === 'limit') {
          for (const dir of f.dir ? [f.dir] : [1, -1]) {
            if (!r.n(dir)) continue;
            const qs = r.qCurb(dir) + (r.bike ? C.BIKE_W : 0) + (r.kind === 'highway' ? r.shoulder + 1.2 : 1.2);
            const sEnter = dir > 0 ? f.s0 : f.s1;
            const p = r.toXY(sEnter, dir * qs), fv = r.dirVec(-dir);
            addSign('speed', f.limit, p.x, p.y, 2.3, fv.x, fv.y, 0.6, 0.8);
          }
        }
        if (f.type === 'gantry') {
          const fv = r.dirVec(-f.dir);
          const q0 = r.qLeft(f.dir), q1 = r.qCurb(f.dir) + r.shoulder + 1;
          const pa = r.toXY(f.s, f.dir * (q0 - 0.5)), pb = r.toXY(f.s, f.dir * q1);
          poles.add(pa.x, 3.6, -pa.y, 0, 3, 7.2, 3); poles.add(pb.x, 3.6, -pb.y, 0, 3, 7.2, 3);
          const pm = r.toXY(f.s, f.dir * (q0 + q1) / 2);
          darkBox.add(pm.x, 7.1, -pm.y, r.axis === 'h' ? Math.PI / 2 : 0, q1 - q0 + 1, 0.25, 0.25);
          const pt = r.toXY(f.s, f.dir * (f.q || (q0 + q1) / 2));
          addSign('exit', f.text, pt.x, pt.y, 6.0, fv.x, fv.y, f.w || 6, (f.w || 6) / 2, true);
        }
        if (f.type === 'shield') {
          const fv = r.dirVec(-f.dir);
          const qs = r.qCurb(f.dir) + r.shoulder + 1.5;
          const p = r.toXY(f.s, f.dir * qs);
          addSign('kingshwy', undefined, p.x, p.y, 2.5, fv.x, fv.y, 0.9, 1.2);
        }
      }
      // speed limit signs after each intersection / road start
      for (const seg of net.segs) {
        if (seg.bike || seg.lane !== seg.road.n(seg.dir) - 1 || seg.len < 70) continue;
        const r = seg.road;
        if (r.kind === 'highway' && seg.fromNode === null && seg.sStart !== r.a0) continue;
        const sPos = seg.sStart + seg.dir * 14;
        if (net.features.some((f) => f.type === 'schoolZone' && f.road === r && sPos > f.s0 - 5 && sPos < f.s1 + 5)) continue;
        const lim = net.speedLimit(r, seg.dir, sPos, false);
        const qs = r.qCurb(seg.dir) + (r.bike ? C.BIKE_W : 0) + (r.kind === 'highway' ? r.shoulder + 1.2 : r.sidewalk ? 1.2 : 1.8);
        const p = r.toXY(sPos, seg.dir * qs), fv = r.dirVec(-seg.dir);
        addSign('speed', lim, p.x, p.y, 2.3, fv.x, fv.y, 0.6, 0.8);
      }

      // ---------- street lamps ----------
      const lampHeads = new Inst(new THREE.BoxGeometry(0.7, 0.15, 0.35), new THREE.MeshBasicMaterial({ color: 0x777777 }));
      const glows = new Inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: DS.Tex.get('glow'), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      if (style !== 'rural') {
        for (const r of net.roads) {
          if (r.kind === 'highway') continue;
          const spacing = 38;
          for (let s = r.a0 + 10; s < r.a1 - 5; s += spacing) {
            if (r.nodes.some((n) => Math.abs(net.nodeS(n, r) - s) < (n.ring ? n.ring.r1 + 8 : 14))) continue;
            for (const sgn of [1, -1]) {
              const u = sgn > 0 ? r.uMax + (r.sidewalk ? 0.5 : 1.8) : r.uMin - (r.sidewalk ? 0.5 : 1.8);
              const p = r.toXY(s + sgn * 8, u);
              poles.add(p.x, 4.25, -p.y, 0, 1.6, 8.5, 1.6);
              const inward = r.toXY(s + sgn * 8, u - sgn * 1.1);
              lampHeads.add(inward.x, 8.4, -inward.y, r.axis === 'h' ? Math.PI / 2 : 0);
              const g = r.toXY(s + sgn * 8, u - sgn * 3.5);
              glows.add(g.x, 0.06, -g.y, 0, 11, 1, 11);
            }
          }
        }
      }

      // ---------- buildings & landscape ----------
      this.landscape(G, net, style, rng, bldB, roofB, root, out, winter);

      // ---------- black ice (winter) ----------
      if (winter) {
        const iceB = new DS.GeoBatch();
        const cand = net.segs.filter((s) => !s.bike && s.len > 40);
        const n = Math.min(cand.length, sc.icePatches || 26);
        for (let i = 0; i < n; i++) {
          const seg = cand[Math.floor(rng() * cand.length)];
          const r = seg.road;
          const sAlong = seg.toNode ? seg.len - U.lerp(10, 35, rng()) : U.lerp(10, seg.len - 10, rng());
          const sRoad = seg.sStart + seg.dir * sAlong;
          const len = U.lerp(10, 22, rng());
          const u = seg.u;
          const p = r.toXY(sRoad, u);
          const w = r.laneW * 0.95;
          iceB.ground(p.x, p.y, len, w, r.heading(1), H.mark - 0.01, 0x262c33);
          const rect = r.axis === 'h' ? { x0: p.x - len / 2, x1: p.x + len / 2, y0: p.y - w / 2, y1: p.y + w / 2 } : { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - len / 2, y1: p.y + len / 2 };
          out.iceRects.push(rect);
        }
        if (!iceB.empty) {
          const ice = iceB.build(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 120, specular: 0x99aabb, transparent: true, opacity: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
          root.add(ice);
        }
      }

      // ---------- assemble ----------
      if (!roadB.empty) root.add(roadB.build(roadMat));
      if (!markB.empty) root.add(markB.build(markMat));
      if (!swB.empty) root.add(swB.build(solidMat));
      if (!bldB.empty) root.add(bldB.build(bldMat));
      if (!roofB.empty) root.add(roofB.build(solidMat));
      for (const inst of [poles, darkBox, yellowBox, signBack, lampHeads]) { const m = inst.build(); if (m) root.add(m); }
      for (const inst of signs.values()) { const m = inst.build(); if (m) root.add(m); }
      const lm = lampInst.build(); if (lm) { root.add(lm); out.lampMesh = lm; }
      const gm = glows.build(); if (gm) { root.add(gm); out.glows = gm; gm.visible = !!G.night; }
      out.lampHeads = lampHeads.mesh;
      if (this._trees) { for (const m of this._trees.build()) root.add(m); this._trees = null; }
      scene.add(root);
      return out;
    },

    rectXY(r, s0, s1, u0, u1) {
      const a = r.toXY(s0, u0), b = r.toXY(s1, u1);
      return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
    },

    // solid or dashed painted line along road at lateral u. solidRange: [s0,s1] forced solid within dashed line
    dashLine(B, r, u, s0, s1, w, color, solidRange, dash, gap) {
      const hd = r.heading(1);
      const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
      if (!dash) { const p = r.toXY((lo + hi) / 2, u); B.ground(p.x, p.y, hi - lo, w, hd, 0.04, color); return; }
      if (solidRange) {
        const a = Math.max(lo, Math.min(solidRange[0], solidRange[1])), b = Math.min(hi, Math.max(solidRange[0], solidRange[1]));
        if (b > a) { const p = r.toXY((a + b) / 2, u); B.ground(p.x, p.y, b - a, w, hd, 0.04, color); }
      }
      for (let s = lo; s + dash <= hi; s += dash + gap) {
        if (solidRange && s >= Math.min(solidRange[0], solidRange[1]) && s <= Math.max(solidRange[0], solidRange[1])) continue;
        const p = r.toXY(s + dash / 2, u);
        B.ground(p.x, p.y, dash, w, hd, 0.04, color);
      }
    },

    signalHeads(net, n, k, arm, out, poles, darkBox, lampInst, yellowBox) {
      const r = arm.road, dir = arm.dirIn;
      const fv = r.dirVec(-dir);
      const sFar = net.edgeS(n, r, dir, 0) + dir * 1.2;
      const nl = r.n(dir);
      const qHead = r.qLeft(dir) + nl * r.laneW * 0.5;
      const qPole = r.qCurb(dir) + (r.bike ? C.BIKE_W : 0) + (r.sidewalk ? 1.0 : 1.5);
      const pp = r.toXY(sFar, dir * qPole);
      poles.add(pp.x, 3.3, -pp.y, 0, 2.2, 6.6, 2.2);
      // mast arm
      const pm = r.toXY(sFar, dir * (qPole + qHead) / 2);
      yellowBox.add(pm.x, 6.4, -pm.y, r.axis === 'h' ? 0 : Math.PI / 2, 0.12, 0.12, Math.abs(qPole - qHead) + 0.3);
      const heads = [{ q: qHead, y: 5.7 }, { q: qPole - 0.2, y: 3.4 }];
      if (nl > 1) heads.push({ q: r.qLeft(dir) + 0.8 * r.laneW, y: 5.7 });
      for (const h of heads) {
        const p = r.toXY(sFar, dir * h.q);
        yellowBox.add(p.x, h.y, -p.y, facingRot(fv.x, fv.y), 0.42, 1.2, 0.3);
        const fx = p.x + fv.x * 0.18, fy = p.y + fv.y * 0.18;
        const cols = ['R', 'Y', 'G'];
        for (let i = 0; i < 3; i++) {
          const idx = lampInst.add(fx, h.y + 0.38 - i * 0.38, -fy, 0, 1, 1, 1, 0x222222);
          out.signalLamps.push({ idx, node: n, k, c: cols[i] });
        }
        // backplate
        darkBox.add(p.x - fv.x * 0.02, h.y, -(p.y - fv.y * 0.02), facingRot(fv.x, fv.y), 0.75, 1.5, 0.04);
      }
    },

    tree(G, root, x, y, rng, winter, out, scale) {
      if (!this._trees) {
        const trunk = new Inst(new THREE.CylinderGeometry(0.18, 0.26, 1, 6), new THREE.MeshLambertMaterial({ color: 0x5b4030 }));
        const crown = new Inst(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
        const cone = new Inst(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
        this._trees = { trunk, crown, cone, build: () => [trunk.build(), crown.build(), cone.build()].filter(Boolean) };
      }
      const s = (scale || 1) * U.lerp(0.8, 1.4, rng());
      const T = this._trees;
      const conifer = rng() < (winter ? 0.6 : 0.3);
      T.trunk.add(x, 1.2 * s, -y, 0, s, 2.4 * s, s);
      if (conifer) {
        const c = winter ? new THREE.Color(0x2f4f3a).lerp(new THREE.Color(0xffffff), 0.35).getHex() : 0x2f5d3a;
        T.cone.add(x, 4.2 * s, -y, rng() * 6, 2.2 * s, 6 * s, 2.2 * s, c);
      } else {
        const base = winter ? 0x6b5a4a : [0x3f7a33, 0x4f8a3a, 0x5d9440, 0x2f6b2f][Math.floor(rng() * 4)];
        T.crown.add(x, 3.6 * s, -y, rng() * 6, 2.4 * s, 2.2 * s, 2.4 * s, base);
      }
      out.obstacles.push({ x0: x - 0.3, x1: x + 0.3, y0: y - 0.3, y1: y + 0.3, tree: true });
    },

    // Fills the blocks between roads with buildings, houses, fields or forest
    landscape(G, net, style, rng, bldB, roofB, root, out, winter) {
      const bnd = net.bounds;
      const vs = net.roads.filter((r) => r.axis === 'v'), hs = net.roads.filter((r) => r.axis === 'h');
      const xs = [bnd.x0, ...vs.map((r) => r.c), bnd.x1].sort((a, b) => a - b);
      const ys = [bnd.y0, ...hs.map((r) => r.c), bnd.y1].sort((a, b) => a - b);
      const marginFor = (coord, axisRoads, side) => {
        const r = axisRoads.find((rr) => Math.abs(rr.c - coord) < 0.01);
        if (!r) return 0;
        const extent = side > 0 ? (r.axis === 'v' ? r.uMax : -r.uMin) : (r.axis === 'v' ? -r.uMin : r.uMax);
        return extent + (r.sidewalk ? C.SIDEWALK_W : 2) + (r.kind === 'highway' ? 14 : style === 'downtown' ? 0.6 : 3);
      };
      const landmarks = (G.scenario.landmarks || []);
      for (const lm of landmarks) this.landmark(lm, bldB, roofB, out, rng);
      const blocked = (x0, y0, x1, y1) => {
        for (const lm of landmarks) if (x1 > lm.x - lm.w / 2 - 2 && x0 < lm.x + lm.w / 2 + 2 && y1 > lm.y - lm.d / 2 - 2 && y0 < lm.y + lm.d / 2 + 2) return true;
        for (const rp of net.ramps) for (const p of rp.pts) if (p.x > x0 - 14 && p.x < x1 + 14 && p.y > y0 - 14 && p.y < y1 + 14) return true;
        // roads that do not span the whole cell (short side roads)
        for (const r of net.roads) {
          const a = r.toXY(r.a0, r.uMin - 4), b = r.toXY(r.a1, r.uMax + 4);
          const rx0 = Math.min(a.x, b.x), rx1 = Math.max(a.x, b.x), ry0 = Math.min(a.y, b.y), ry1 = Math.max(a.y, b.y);
          if (x1 > rx0 && x0 < rx1 && y1 > ry0 && y0 < ry1) return true;
        }
        for (const n of net.nodes) if (n.ring && x1 > n.x - n.ring.r1 - 6 && x0 < n.x + n.ring.r1 + 6 && y1 > n.y - n.ring.r1 - 6 && y0 < n.y + n.ring.r1 + 6) return true;
        return false;
      };
      for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
        const x0 = xs[i] + marginFor(xs[i], vs, 1), x1 = xs[i + 1] - marginFor(xs[i + 1], vs, -1);
        const y0 = ys[j] + marginFor(ys[j], hs, 1), y1 = ys[j + 1] - marginFor(ys[j + 1], hs, -1);
        if (x1 - x0 < 8 || y1 - y0 < 8) continue;
        const cell = { x0, x1, y0, y1 };
        if (style === 'downtown') this.downtownBlock(cell, rng, bldB, roofB, out, blocked);
        else if (style === 'suburban') this.suburbanBlock(cell, rng, bldB, roofB, root, out, blocked, winter, G);
        else this.ruralBlock(cell, rng, bldB, roofB, root, out, blocked, winter, G, style);
      }
    },

    building(B, R, x0, y0, x1, y1, h, color, out, roofCol) {
      const w = x1 - x0, d = y1 - y0;
      B.box((x0 + x1) / 2, h / 2, -(y0 + y1) / 2, w, h, d, color, 0, [Math.max(w, d) / 4, h / 3.6]);
      R.box((x0 + x1) / 2, h + 0.15, -(y0 + y1) / 2, w + 0.3, 0.3, d + 0.3, roofCol || 0x55585c);
      out.obstacles.push({ x0, x1, y0, y1 });
    },

    downtownBlock(c, rng, B, R, out, blocked) {
      const pal = [0x9c8f80, 0x7d8a96, 0xb7a58f, 0x6e7781, 0xc2b8a3, 0x8b6f5c, 0x5f6b73, 0xa3adb5];
      const lotW = 20, lotD = 22;
      const nx = Math.max(1, Math.round((c.x1 - c.x0) / lotW)), ny = Math.max(1, Math.round((c.y1 - c.y0) / lotD));
      const wx = (c.x1 - c.x0) / nx, wy = (c.y1 - c.y0) / ny;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const edge = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
        if (!edge && rng() < 0.6) continue;
        const x0 = c.x0 + i * wx + 0.4, x1 = c.x0 + (i + 1) * wx - 0.4, y0 = c.y0 + j * wy + 0.4, y1 = c.y0 + (j + 1) * wy - 0.4;
        if (blocked(x0, y0, x1, y1)) continue;
        const tower = rng() < 0.18;
        const h = tower ? U.lerp(45, 95, rng()) : U.lerp(9, 32, rng());
        this.building(B, R, x0, y0, x1, y1, h, pal[Math.floor(rng() * pal.length)], out);
      }
    },

    suburbanBlock(c, rng, B, R, root, out, blocked, winter, G) {
      const pal = [0xe8dcc4, 0xc9b79c, 0xa8b5c0, 0xd9c7b0, 0xb5967a, 0xeeeeea, 0x9fae94, 0xc7a48a];
      const roofs = [0x4b3b33, 0x3c4148, 0x6b4b3a, 0x2f3338, 0x7a3e2e];
      const sides = [
        { a: c.x0, b: c.x1, fixed: c.y0, axis: 'x', inward: 1 }, { a: c.x0, b: c.x1, fixed: c.y1, axis: 'x', inward: -1 },
        { a: c.y0 + 22, b: c.y1 - 22, fixed: c.x0, axis: 'y', inward: 1 }, { a: c.y0 + 22, b: c.y1 - 22, fixed: c.x1, axis: 'y', inward: -1 },
      ];
      for (const sd of sides) {
        const L = sd.b - sd.a;
        if (L < 14) continue;
        const n = Math.floor(L / 19);
        for (let i = 0; i < n; i++) {
          const m = sd.a + (i + 0.5) * (L / n);
          const hw = U.lerp(4.5, 6, rng()), hd = U.lerp(4.5, 6, rng());
          const set = 7 + rng() * 3;
          let x0, x1, y0, y1;
          if (sd.axis === 'x') { x0 = m - hw; x1 = m + hw; const yb = sd.fixed + sd.inward * set; y0 = Math.min(yb, yb + sd.inward * hd * 2); y1 = Math.max(yb, yb + sd.inward * hd * 2); }
          else { y0 = m - hw; y1 = m + hw; const xb = sd.fixed + sd.inward * set; x0 = Math.min(xb, xb + sd.inward * hd * 2); x1 = Math.max(xb, xb + sd.inward * hd * 2); }
          if (x1 > c.x1 || x0 < c.x0 || y1 > c.y1 || y0 < c.y0 || blocked(x0, y0, x1, y1)) continue;
          const h = rng() < 0.3 ? 6.2 : 3.6;
          B.box((x0 + x1) / 2, h / 2, -(y0 + y1) / 2, x1 - x0, h, y1 - y0, pal[Math.floor(rng() * pal.length)], 0, [(x1 - x0) / 6, h > 5 ? 1.5 : 0.8]);
          const roof = new THREE.ConeGeometry(Math.hypot(x1 - x0, y1 - y0) / 2 * 1.02, 2.6, 4);
          const mtx = new THREE.Matrix4().makeRotationY(Math.PI / 4);
          const sc = new THREE.Matrix4().makeScale(1, 1, (y1 - y0) / (x1 - x0));
          const mm = new THREE.Matrix4().makeTranslation((x0 + x1) / 2, h + 1.3, -(y0 + y1) / 2).multiply(sc).multiply(mtx);
          R.addGeo(roof, mm, winter ? 0xf4f6f8 : roofs[Math.floor(rng() * roofs.length)]);
          roof.dispose();
          out.obstacles.push({ x0, x1, y0, y1 });
          // driveway
          if (sd.axis === 'x') { const dx = x1 + 1.8; const ya = sd.fixed, yb = sd.fixed + sd.inward * (set + 2); B.ground(dx, (ya + yb) / 2, Math.abs(yb - ya), 3, Math.PI / 2, 0.03, winter ? 0xcdd3d8 : 0x9b9890); }
          // yard trees
          if (rng() < 0.7) {
            const tx = U.lerp(c.x0 + 4, c.x1 - 4, rng()), ty = U.lerp(c.y0 + 4, c.y1 - 4, rng());
            if (!blocked(tx - 1, ty - 1, tx + 1, ty + 1) && !out.obstacles.some((o) => tx > o.x0 - 2 && tx < o.x1 + 2 && ty > o.y0 - 2 && ty < o.y1 + 2)) this.tree(G, root, tx, ty, rng, winter, out);
          }
        }
      }
    },

    ruralBlock(c, rng, B, R, root, out, blocked, winter, G, style) {
      const area = (c.x1 - c.x0) * (c.y1 - c.y0);
      // fields
      if (style === 'rural' && !winter) {
        const fc = [0x8aa04a, 0xb59f4f, 0x6f8f3a, 0x9c8b4d][Math.floor(rng() * 4)];
        B.ground((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, c.x1 - c.x0 - 10, c.y1 - c.y0 - 10, 0, 0.01, fc);
      }
      // tree lines and woods
      const n = Math.min(260, Math.floor(area / (style === 'highway' ? 260 : 700)));
      for (let i = 0; i < n; i++) {
        let x, y;
        if (rng() < 0.5) { // near edges (windbreaks)
          const e = Math.floor(rng() * 4), t = rng();
          x = e < 2 ? U.lerp(c.x0, c.x1, t) : e === 2 ? c.x0 + 3 + rng() * 10 : c.x1 - 3 - rng() * 10;
          y = e >= 2 ? U.lerp(c.y0, c.y1, t) : e === 0 ? c.y0 + 3 + rng() * 10 : c.y1 - 3 - rng() * 10;
        } else { x = U.lerp(c.x0 + 3, c.x1 - 3, rng()); y = U.lerp(c.y0 + 3, c.y1 - 3, rng()); if (style === 'rural' && rng() < 0.7) continue; }
        if (blocked(x - 1, y - 1, x + 1, y + 1)) continue;
        this.tree(G, root, x, y, rng, winter, out, 1.2);
      }
      // a farmhouse and barn
      if (style === 'rural' && area > 20000 && rng() < 0.8) {
        const x = U.lerp(c.x0 + 30, c.x1 - 40, rng()), y = U.lerp(c.y0 + 30, c.y1 - 40, rng());
        if (!blocked(x - 12, y - 12, x + 30, y + 14)) {
          this.building(B, R, x - 6, y - 5, x + 6, y + 5, 6, 0xe8e0cc, out, winter ? 0xf2f4f6 : 0x4b3b33);
          this.building(B, R, x + 14, y - 8, x + 30, y + 8, 9, 0x8b2e23, out, winter ? 0xf2f4f6 : 0x5a5f63);
        }
      }
    },

    landmark(lm, B, R, out, rng) {
      if (lm.type === 'school') {
        this.building(B, R, lm.x - lm.w / 2, lm.y - lm.d / 2, lm.x + lm.w / 2, lm.y + lm.d / 2, 8, 0xa0522d, out, 0x5a5f63);
        // flagpole
        B.box(lm.x + lm.w / 2 + 4, 5, -(lm.y), 0.12, 10, 0.12, 0xdddddd);
        B.box(lm.x + lm.w / 2 + 4.8, 9.4, -(lm.y), 1.6, 0.8, 0.02, 0xd52b1e);
      } else if (lm.type === 'tower') {
        this.building(B, R, lm.x - lm.w / 2, lm.y - lm.d / 2, lm.x + lm.w / 2, lm.y + lm.d / 2, lm.h || 120, 0x7d8a96, out);
      } else if (lm.type === 'plaza') {
        B.ground(lm.x, lm.y, lm.w, lm.d, 0, 0.05, 0xb9b3a8);
      }
      void rng;
    },
  };
  DS.World3D = World3D;
})();
