/* Road network: axis-aligned roads, intersections (signals / stops / roundabouts),
 * lane geometry, AI path segments, localisation and route navigation.
 *
 * Road-local coordinates: s = distance along the road axis (x for 'h', y for 'v'),
 * u = lateral offset to the RIGHT of the road's positive direction (east / north).
 * Canada drives on the right, so the +dir lanes are at u > 0.
 */
(function () {
  'use strict';
  const DS = window.DS, U = DS.U;

  const C = (DS.C = {
    LANE_W: 3.5,
    BIKE_W: 1.8,
    SIDEWALK_W: 3.5,
    CW_W: 3.2, // crosswalk width
    STOP_GAP: 0.6, // gap between stop line and crosswalk
  });

  // Compass arms: 0=N 1=E 2=S 3=W
  const ARM_VEC = [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }];
  const ARM_NAME = ['north', 'east', 'south', 'west'];
  DS.ARM_VEC = ARM_VEC;
  DS.ARM_NAME = ARM_NAME;
  // movement from inbound arm k to outbound arm j
  function relation(k, j) {
    const d = (j - k + 4) % 4;
    return d === 2 ? 'S' : d === 3 ? 'R' : d === 1 ? 'L' : 'U';
  }
  DS.relation = relation;

  class Road {
    constructor(o) {
      Object.assign(this, {
        name: 'Road', lanes: [1, 1], laneW: C.LANE_W, median: 0, bike: false, streetcar: false,
        limit: 50, sidewalk: true, shoulder: 0, kind: 'street', aux: [], barrier: false, rural: false,
      }, o);
      const [np, nn] = this.lanes, w = this.laneW, bw = this.bike ? C.BIKE_W : 0, sh = this.shoulder;
      this.oneway = np > 0 && nn === 0 ? 1 : nn > 0 && np === 0 ? -1 : 0;
      if (this.oneway === 0) {
        this.uMax = this.median / 2 + np * w + bw + sh;
        this.uMin = -(this.median / 2 + nn * w + bw + sh);
      } else if (this.oneway === 1) {
        this.uMin = -(np * w) / 2 - sh * 0.3;
        this.uMax = (np * w) / 2 + bw + sh;
      } else {
        this.uMax = (nn * w) / 2 + sh * 0.3;
        this.uMin = -((nn * w) / 2 + bw + sh);
      }
      this.nodes = [];
    }
    n(dir) { return dir > 0 ? this.lanes[0] : this.lanes[1]; }
    dirVec(dir) { return this.axis === 'h' ? { x: dir, y: 0 } : { x: 0, y: dir }; }
    heading(dir) { const v = this.dirVec(dir); return Math.atan2(v.y, v.x); }
    toST(x, y) { return this.axis === 'h' ? { s: x, u: -(y - this.c) } : { s: y, u: x - this.c }; }
    toXY(s, u) { return this.axis === 'h' ? { x: s, y: this.c - u } : { x: this.c + u, y: s }; }
    // lateral offset (road u) of lane centre
    laneU(dir, i) {
      const w = this.laneW;
      if (this.oneway === 0) return dir * (this.median / 2 + (i + 0.5) * w);
      return dir * ((-this.n(dir) * w) / 2 + (i + 0.5) * w);
    }
    bikeU(dir) {
      const w = this.laneW, n = this.n(dir);
      if (this.oneway === 0) return dir * (this.median / 2 + n * w + C.BIKE_W / 2);
      return dir * ((n * w) / 2 + C.BIKE_W / 2);
    }
    // inner (left) edge of the travel lanes for dir, in direction-frame q (right +)
    qLeft(dir) { return this.oneway === 0 ? this.median / 2 : (-this.n(dir) * this.laneW) / 2; }
    qCurb(dir) { return this.qLeft(dir) + this.n(dir) * this.laneW; } // right edge of last lane
    auxAt(dir, s) { return this.aux.find((a) => a.dir === dir && s >= a.s0 && s <= a.s1) || null; }
    // classify a lateral position for a vehicle travelling in `dir`
    classify(dir, u, s) {
      const q = dir * u, w = this.laneW, n = this.n(dir);
      if (this.oneway !== 0 && dir !== this.oneway) return { kind: 'wrongway', q };
      const ql = this.qLeft(dir);
      if (q < ql) {
        if (this.oneway === 0) return { kind: q < 0 ? 'oncoming' : 'median', q };
        return { kind: 'off', q };
      }
      let rel = q - ql;
      const lane = Math.floor(rel / w);
      if (lane < n) return { kind: 'lane', lane, q, off: rel - (lane + 0.5) * w };
      rel -= n * w;
      if (this.bike) { if (rel < C.BIKE_W) return { kind: 'bike', q }; rel -= C.BIKE_W; }
      const aux = this.auxAt(dir, s);
      if (aux) {
        if (rel < w) return { kind: 'aux', aux, lane: n, q, off: rel - 0.5 * w };
        rel -= w;
      }
      if (rel < this.shoulder) return { kind: 'shoulder', q };
      return { kind: 'off', q };
    }
  }

  class RoadNet {
    constructor(spec) {
      this.spec = spec;
      this.roads = [];
      this.nodes = [];
      this.segs = [];
      this.segIndex = new Map();
      this.connCache = new Map();
      this.ramps = [];
      this.features = spec.features || [];
      this.bounds = spec.bounds || { x0: -400, x1: 400, y0: -400, y1: 400 };
      let id = 0;
      for (const r of spec.roads) this.roads.push(new Road(Object.assign({ id: id++ }, r)));
      this.roadByName = {};
      for (const r of this.roads) this.roadByName[r.name] = r;
      this._buildNodes(spec.nodes || {});
      this._buildSegs();
      for (const rp of spec.ramps || []) this._addRamp(rp);
      for (const f of this.features) if (f.road && typeof f.road === 'string') f.road = this.roadByName[f.road];
      this._buildGraph();
    }

    road(name) { return this.roadByName[name]; }

    _buildNodes(ctrl) {
      const hs = this.roads.filter((r) => r.axis === 'h'), vs = this.roads.filter((r) => r.axis === 'v');
      let id = 0;
      for (const h of hs) for (const v of vs) {
        const x = v.c, y = h.c;
        if (x < h.a0 - 1 || x > h.a1 + 1 || y < v.a0 - 1 || y > v.a1 + 1) continue;
        const key = h.name + '|' + v.name;
        const cfg = ctrl[key] || { control: 'stop4' };
        const node = {
          id: id++, x, y, h, v, key, control: cfg.control, name: v.name + ' & ' + h.name,
          rtorBan: new Set(cfg.rtorBan || []), stopArms: new Set(cfg.stopArms || []),
          crosswalk: cfg.crosswalk !== undefined ? cfg.crosswalk : h.sidewalk && v.sidewalk,
          queue: new Map(), arms: [null, null, null, null],
        };
        if (node.control === 'stop4') node.stopArms = new Set([0, 1, 2, 3]);
        // arms
        const mk = (k, road, dirOut) => ({ k, road, dirOut, dirIn: -dirOut });
        if (v.a1 > y + 5) node.arms[0] = mk(0, v, 1);
        if (h.a1 > x + 5) node.arms[1] = mk(1, h, 1);
        if (v.a0 < y - 5) node.arms[2] = mk(2, v, -1);
        if (h.a0 < x - 5) node.arms[3] = mk(3, h, -1);
        if (node.control === 'roundabout') {
          node.ring = Object.assign({ r0: 9, r1: 19 }, cfg.ring || {});
          node.ring.rc = (node.ring.r0 + node.ring.r1) / 2;
          node.box = { x0: x - node.ring.r1, x1: x + node.ring.r1, y0: y - node.ring.r1, y1: y + node.ring.r1 };
          node.crosswalk = false;
        } else {
          // corner margin gives turning room (flared curb returns); crosswalks & stop lines sit outside it
          const m = cfg.corner !== undefined ? cfg.corner : node.crosswalk ? 3 : 4.5;
          node.box = { x0: x + v.uMin - m, x1: x + v.uMax + m, y0: y - h.uMax - m, y1: y - h.uMin + m };
        }
        if (node.control === 'signal') {
          node.sig = { t: cfg.offset !== undefined ? cfg.offset : U.rand(0, 30), green: cfg.green || 16, amber: 3.5, allRed: 2 };
          node.sig.cycle = 2 * (node.sig.green + node.sig.amber + node.sig.allRed);
        }
        h.nodes.push(node); v.nodes.push(node);
        this.nodes.push(node);
      }
      for (const r of this.roads) r.nodes.sort((a, b) => (r.axis === 'h' ? a.x - b.x : a.y - b.y));
    }

    nodeS(node, road) { return road.axis === 'h' ? node.x : node.y; }
    // s position of node edge on `road`, on the side of direction sideDir (+1 high side, -1 low side), at lateral u
    edgeS(node, road, sideDir, u) {
      const ns = this.nodeS(node, road);
      if (node.ring) return ns + sideDir * Math.sqrt(Math.max(1, node.ring.r1 * node.ring.r1 - u * u));
      const b = node.box;
      if (road.axis === 'h') return sideDir > 0 ? b.x1 : b.x0;
      return sideDir > 0 ? b.y1 : b.y0;
    }
    armOf(node, road, dirOut) {
      return node.arms.find((a) => a && a.road === road && a.dirOut === dirOut) || null;
    }
    // which arm a point lies on (relative to node centre)
    armAt(node, x, y) {
      const dx = x - node.x, dy = y - node.y;
      if (!node.ring) {
        // which edge of the (possibly non-square) box the point is beyond
        const b = node.box;
        const o = [y - b.y1, x - b.x1, b.y0 - y, b.x0 - x]; // N E S W overshoots
        let best = -1, bv = 0;
        for (let k = 0; k < 4; k++) if (o[k] > bv) { bv = o[k]; best = k; }
        if (best >= 0) return best;
        const hw = (b.x1 - b.x0) / 2 || 1, hh = (b.y1 - b.y0) / 2 || 1;
        if (Math.abs(dx) / hw > Math.abs(dy) / hh) return dx > 0 ? 1 : 3;
        return dy > 0 ? 0 : 2;
      }
      if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
      return dy > 0 ? 0 : 2;
    }

    _buildSegs() {
      let id = 0;
      for (const r of this.roads) {
        for (const dir of [1, -1]) {
          const n = r.n(dir);
          if (!n) continue;
          const laneList = [];
          for (let i = 0; i < n; i++) laneList.push({ lane: i, u: r.laneU(dir, i) });
          if (r.bike) laneList.push({ lane: 'B', u: r.bikeU(dir) });
          for (const L of laneList) {
            // breakpoints along s (ascending)
            const pts = [{ s: r.a0, node: null }];
            for (const nd of r.nodes) {
              pts.push({ s: this.edgeS(nd, r, -1, L.u), node: nd, side: 'low' });
              pts.push({ s: this.edgeS(nd, r, 1, L.u), node: nd, side: 'high' });
            }
            pts.push({ s: r.a1, node: null });
            const intervals = [];
            for (let i = 0; i < pts.length; i += 2) if (pts[i + 1].s - pts[i].s > 1) intervals.push([pts[i], pts[i + 1]]);
            if (dir < 0) { intervals.reverse(); intervals.forEach((iv) => iv.reverse()); }
            for (const [a, b] of intervals) {
              const p0 = r.toXY(a.s, L.u), p1 = r.toXY(b.s, L.u);
              const seg = {
                id: id++, road: r, dir, lane: L.lane, u: L.u, sStart: a.s, sEnd: b.s,
                poly: new U.Polyline([p0, p1]), fromNode: a.node, toNode: b.node,
                heading: r.heading(dir), bike: L.lane === 'B',
              };
              seg.len = seg.poly.length;
              seg.fromArm = a.node ? this.armOf(a.node, r, dir) : null;
              seg.toArm = b.node ? this.armOf(b.node, r, -dir) : null;
              const tn = b.node;
              seg.stopDist = tn ? (tn.crosswalk ? C.CW_W + C.STOP_GAP : tn.ring ? 0.8 : 1.0) : 0;
              this.segs.push(seg);
              if (seg.fromArm) this.segIndex.set(a.node.id + ':' + seg.fromArm.k + ':out:' + L.lane, seg);
              if (seg.toArm) this.segIndex.set(b.node.id + ':' + seg.toArm.k + ':in:' + L.lane, seg);
              if (!seg.fromArm) this.segIndex.set('start:' + r.id + ':' + dir + ':' + L.lane, seg);
            }
          }
        }
      }
    }
    segOut(node, k, lane) { return this.segIndex.get(node.id + ':' + k + ':out:' + lane) || null; }
    segIn(node, k, lane) { return this.segIndex.get(node.id + ':' + k + ':in:' + lane) || null; }
    // all lane segments of road r in dir & lane, in travel order
    segsAlong(r, dir, lane) {
      return this.segs.filter((s) => s.road === r && s.dir === dir && s.lane === lane)
        .sort((a, b) => dir * (a.sStart - b.sStart));
    }
    segAt(r, dir, lane, s) {
      return this.segs.find((g) => g.road === r && g.dir === dir && g.lane === lane &&
        (s - g.sStart) * dir >= -0.01 && (g.sEnd - s) * dir >= -0.01) || null;
    }

    // Allowed movements for a vehicle on seg arriving at seg.toNode
    movesFrom(seg) {
      const node = seg.toNode;
      if (!node || !seg.toArm) return [];
      const k = seg.toArm.k, res = [];
      const nIn = seg.road.n(seg.dir);
      for (let j = 0; j < 4; j++) {
        const arm = node.arms[j];
        if (!arm) continue;
        const rel = relation(k, j);
        if (rel === 'U' && !node.ring) continue;
        const nOut = arm.road.n(arm.dirOut);
        if (!nOut) continue;
        if (seg.bike) { if (rel === 'S' && arm.road.bike) res.push({ move: 'S', armOut: j, laneOut: 'B' }); continue; }
        let laneOut;
        if (rel === 'L') laneOut = 0;
        else if (rel === 'R') laneOut = nOut - 1;
        else laneOut = Math.min(seg.lane, nOut - 1);
        if (rel === 'U') laneOut = nOut - 1;
        res.push({ move: rel, armOut: j, laneOut });
      }
      if (seg.bike || node.ring || nIn === 1) return res;
      const ok = res.filter((m) => {
        if (m.move === 'S') return true;
        if (m.move === 'L') return seg.lane === 0;
        if (m.move === 'R') return seg.lane === nIn - 1;
        return false;
      });
      return ok.length ? ok : res;
    }

    connector(seg, mv) {
      const key = seg.id + '>' + mv.armOut + ':' + mv.laneOut;
      if (this.connCache.has(key)) return this.connCache.get(key);
      const node = seg.toNode;
      const out = this.segOut(node, mv.armOut, mv.laneOut);
      if (!out) return null;
      const p0 = seg.poly.pts[1], p3 = out.poly.pts[0];
      const d0 = seg.road.dirVec(seg.dir), d3 = out.road.dirVec(out.dir);
      let pts;
      if (node.ring) {
        const { rc } = node.ring;
        const a0 = Math.atan2(p0.y - node.y, p0.x - node.x);
        let a1 = Math.atan2(p3.y - node.y, p3.x - node.x);
        while (a1 <= a0 + 0.5) a1 += Math.PI * 2;
        const e0 = a0 + 0.42, e1 = a1 - 0.42;
        const A = { x: node.x + rc * Math.cos(e0), y: node.y + rc * Math.sin(e0) };
        const B = { x: node.x + rc * Math.cos(e1), y: node.y + rc * Math.sin(e1) };
        const tA = { x: -Math.sin(e0), y: Math.cos(e0) }, tB = { x: -Math.sin(e1), y: Math.cos(e1) };
        const entry = U.bezier3(p0, { x: p0.x + d0.x * 3, y: p0.y + d0.y * 3 }, { x: A.x - tA.x * 3, y: A.y - tA.y * 3 }, A, 6);
        const ring = U.arc(node.x, node.y, rc, e0, e1, Math.max(4, Math.ceil((e1 - e0) * 6)));
        const exit = U.bezier3(B, { x: B.x + tB.x * 3, y: B.y + tB.y * 3 }, { x: p3.x - d3.x * 3, y: p3.y - d3.y * 3 }, p3, 6);
        pts = entry.concat(ring.slice(1), exit.slice(1));
      } else if (mv.move === 'S') {
        pts = [p0, p3];
      } else {
        const c = U.lineIntersect(p0, d0, p3, d3) || { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
        pts = U.bezier2(p0, c, p3, 12);
      }
      const conn = {
        id: 'c' + key, conn: true, node, fromSeg: seg, toSeg: out, move: mv.move, armIn: seg.toArm.k,
        armOut: mv.armOut, poly: new U.Polyline(pts), bike: seg.bike,
      };
      conn.len = conn.poly.length;
      this.connCache.set(key, conn);
      return conn;
    }

    _addRamp(rp) {
      const poly = new U.Polyline(rp.pts);
      this.ramps.push(Object.assign({ width: 4.2, limit: 80, poly }, rp));
    }

    // ---------- localisation ----------
    locate(x, y) {
      const res = { node: null, road: null, ramp: null, s: 0, u: 0, surface: 'off', inIsland: false };
      for (const n of this.nodes) {
        if (n.ring) {
          const d = Math.hypot(x - n.x, y - n.y);
          if (d <= n.ring.r1) { res.node = n; res.surface = d < n.ring.r0 ? 'island' : 'road'; res.ringD = d; break; }
        } else if (x >= n.box.x0 && x <= n.box.x1 && y >= n.box.y0 && y <= n.box.y1) { res.node = n; res.surface = 'road'; break; }
      }
      let best = null;
      for (const r of this.roads) {
        const st = r.toST(x, y);
        if (st.s < r.a0 - 0.5 || st.s > r.a1 + 0.5) continue;
        const sw = r.sidewalk ? C.SIDEWALK_W : r.kind === 'highway' ? 0 : 1.8;
        let uMax = r.uMax, uMin = r.uMin;
        // auxiliary lanes widen the road
        for (const a of r.aux) if (st.s >= a.s0 - 60 && st.s <= a.s1 + 60) { if (a.dir > 0) uMax = Math.max(uMax, r.uMax + r.laneW); else uMin = Math.min(uMin, r.uMin - r.laneW); }
        if (st.u < uMin - sw || st.u > uMax + sw) continue;
        let surface = st.u >= uMin && st.u <= uMax ? 'road' : r.sidewalk ? 'sidewalk' : 'shoulder';
        if (surface === 'road') {
          // aux lane shoulders outside the aux zone are grass/gravel
          const cl = r.classify(st.u >= 0 ? 1 : -1, st.u, st.s);
          if (cl.kind === 'off') surface = 'shoulder';
          if (r.median > 0 && Math.abs(st.u) < r.median / 2) surface = 'median';
        }
        const cand = { road: r, s: st.s, u: st.u, surface };
        if (!best || (surface === 'road' && best.surface !== 'road')) best = cand;
      }
      if (best) { res.road = best.road; res.s = best.s; res.u = best.u; if (!res.node) res.surface = best.surface; }
      if (!res.node && (!best || best.surface !== 'road')) {
        for (const rp of this.ramps) {
          const pr = rp.poly.project(x, y);
          if (pr.d < rp.width / 2 + 0.3) { res.ramp = rp; res.rampS = pr.s; res.rampLat = pr.lat; res.surface = 'road'; res.road = null; break; }
          if (pr.d < rp.width / 2 + 3.5 && !best) { res.ramp = rp; res.rampS = pr.s; res.rampLat = pr.lat; res.surface = 'shoulder'; }
        }
      }
      return res;
    }

    speedLimit(road, dir, s, schoolActive) {
      if (!road) return null;
      let lim = road.limit;
      for (const f of this.features) {
        if (f.road !== road) continue;
        if (f.type === 'limit' && s >= f.s0 && s <= f.s1 && (!f.dir || f.dir === dir)) lim = f.limit;
        if (f.type === 'schoolZone' && schoolActive && s >= f.s0 && s <= f.s1) lim = Math.min(lim, f.limit);
      }
      return lim;
    }
    inSchoolZone(road, s) {
      return this.features.find((f) => f.type === 'schoolZone' && f.road === road && s >= f.s0 && s <= f.s1) || null;
    }

    // Signal state for traffic entering from arm k: 'G' | 'Y' | 'R'
    light(node, k) {
      const sg = node.sig;
      if (!sg) return 'G';
      const t = sg.t % sg.cycle, half = sg.green + sg.amber + sg.allRed;
      const ns = k === 0 || k === 2;
      const tt = ns ? t : (t + half) % sg.cycle;
      if (tt < sg.green) return 'G';
      if (tt < sg.green + sg.amber) return 'Y';
      return 'R';
    }
    // pedestrian walk signal for the crosswalk across arm k
    walk(node, k) {
      const sg = node.sig;
      if (!sg) return true;
      const perp = k === 0 || k === 2 ? 1 : 0; // peds crossing N/S arms walk with E/W green
      const t = sg.t % sg.cycle, half = sg.green + sg.amber + sg.allRed;
      const tt = perp ? (t + half) % sg.cycle : t;
      return tt < sg.green * 0.6;
    }
    // crosswalk geometry for arm k of node
    crosswalk(node, k) {
      if (!node.crosswalk || !node.arms[k]) return null;
      if (node._cw && node._cw[k]) return node._cw[k];
      node._cw = node._cw || [];
      const arm = node.arms[k], r = arm.road;
      const sEdge = this.edgeS(node, r, arm.dirOut, 0);
      const sMid = sEdge + arm.dirOut * (C.CW_W / 2);
      const a = r.toXY(sMid, r.uMin - 2.2), b = r.toXY(sMid, r.uMax + 2.2);
      const p0 = r.toXY(sEdge, r.uMin), p1 = r.toXY(sEdge + arm.dirOut * C.CW_W, r.uMax);
      const rect = { x0: Math.min(p0.x, p1.x), x1: Math.max(p0.x, p1.x), y0: Math.min(p0.y, p1.y), y1: Math.max(p0.y, p1.y) };
      return (node._cw[k] = { node, k, a, b, rect, road: r, sMid });
    }

    // ---------- navigation graph ----------
    _buildGraph() {
      // edges: from node via arm j to next node (or road end)
      this.edges = [];
      for (const n of this.nodes) {
        for (const arm of n.arms) {
          if (!arm || !arm.road.n(arm.dirOut)) continue;
          const r = arm.road, list = r.nodes, idx = list.indexOf(n);
          const next = list[idx + arm.dirOut] || null;
          const len = next ? Math.abs(this.nodeS(next, r) - this.nodeS(n, r)) : Math.abs((arm.dirOut > 0 ? r.a1 : r.a0) - this.nodeS(n, r));
          this.edges.push({ from: n, arm: arm.k, to: next, road: r, dir: arm.dirOut, len });
        }
      }
    }
    // Plan from the node the driver is approaching (entering via inbound arm kIn) to a target on (road, dir, s).
    route(fromNode, kIn, target) {
      const tr = target.road;
      const goalEdges = this.edges.filter((e) => e.road === tr && (!target.dir || e.dir === target.dir) &&
        (e.to ? (target.s - this.nodeS(e.from, tr)) * e.dir > 0 && (this.nodeS(e.to, tr) - target.s) * e.dir > 0
          : (target.s - this.nodeS(e.from, tr)) * e.dir > 0));
      if (!goalEdges.length) return null;
      // Dijkstra over nodes
      const dist = new Map(), prev = new Map(), done = new Set();
      dist.set(fromNode.id, 0);
      const pq = [fromNode];
      const turnCost = { S: 0, R: 15, L: 30, U: 120 };
      const inArm = new Map([[fromNode.id, kIn]]);
      while (pq.length) {
        pq.sort((a, b) => dist.get(a.id) - dist.get(b.id));
        const n = pq.shift();
        if (done.has(n.id)) continue;
        done.add(n.id);
        for (const e of this.edges) {
          if (e.from !== n) continue;
          const k = inArm.get(n.id);
          const rel = k === undefined || k === null ? 'S' : relation(k, e.arm);
          if (rel === 'U' && !n.ring) continue;
          if (goalEdges.includes(e)) {
            const total = dist.get(n.id) + turnCost[rel];
            if (!dist.has('goal') || total < dist.get('goal')) { dist.set('goal', total); prev.set('goal', { n, e }); }
          }
          if (!e.to) continue;
          const nd = dist.get(n.id) + e.len + turnCost[rel];
          if (!dist.has(e.to.id) || nd < dist.get(e.to.id)) {
            dist.set(e.to.id, nd); prev.set(e.to.id, { n, e });
            inArm.set(e.to.id, this.armOf(e.to, e.road, -e.dir).k);
            pq.push(e.to);
          }
        }
      }
      if (!prev.has('goal')) return null;
      const steps = [];
      let cur = prev.get('goal');
      steps.unshift(cur.e);
      while (cur.n !== fromNode) { cur = prev.get(cur.n.id); steps.unshift(cur.e); }
      return steps; // list of edges, first leaves fromNode
    }
    roundaboutExitNumber(node, kIn, kOut) {
      let count = 0, k = kIn;
      for (let i = 0; i < 4; i++) {
        k = (k + 3) % 4; // next arm counter-clockwise
        if (node.arms[k] && node.arms[k].road.n(node.arms[k].dirOut)) count++;
        if (k === kOut) return count;
      }
      return count;
    }
  }

  DS.Road = Road;
  DS.RoadNet = RoadNet;
})();
