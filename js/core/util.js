/* Ontario Road Test Simulator — core utilities
 * World convention: x = east, y = north (metres). Heading θ: 0 = east, CCW positive.
 * Three.js mapping: (x, h, -y). A model built facing +X uses rotation.y = θ.
 */
(function () {
  'use strict';
  const DS = (window.DS = window.DS || {});

  const U = {
    KMH: 3.6,
    G: 9.81,
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    smoothstep: (a, b, t) => { t = U.clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); },
    approach: (v, target, rate) => (v < target ? Math.min(target, v + rate) : Math.max(target, v - rate)),
    angNorm(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; },
    angDiff: (a, b) => U.angNorm(a - b),
    dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    chance: (p) => Math.random() < p,
    // Seeded RNG (mulberry32) for repeatable scenery
    rng(seed) {
      let s = seed >>> 0;
      const f = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      f.range = (a, b) => a + f() * (b - a);
      f.pick = (arr) => arr[Math.floor(f() * arr.length)];
      return f;
    },
    // Rotations of axis-aligned unit vectors
    rotCCW: (v) => ({ x: -v.y, y: v.x }),
    rotCW: (v) => ({ x: v.y, y: -v.x }),
    rightOf: (hx, hy) => ({ x: hy, y: -hx }),
    fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + (s < 10 ? '0' : '') + s; },
  };

  /* Polyline with arc-length parameterisation */
  class Polyline {
    constructor(pts) {
      this.pts = pts;
      this.cum = [0];
      for (let i = 1; i < pts.length; i++) {
        this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      }
      this.length = this.cum[this.cum.length - 1];
    }
    _idx(s) {
      const c = this.cum;
      if (s <= 0) return 0;
      if (s >= this.length) return c.length - 2;
      let lo = 0, hi = c.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
      return lo;
    }
    at(s, out) {
      out = out || {};
      const i = this._idx(s);
      const a = this.pts[i], b = this.pts[i + 1];
      const segLen = this.cum[i + 1] - this.cum[i] || 1e-6;
      const t = U.clamp((s - this.cum[i]) / segLen, 0, 1);
      out.x = a.x + (b.x - a.x) * t;
      out.y = a.y + (b.y - a.y) * t;
      out.hx = (b.x - a.x) / segLen;
      out.hy = (b.y - a.y) / segLen;
      out.heading = Math.atan2(out.hy, out.hx);
      return out;
    }
    // Project a point; returns {s, lat (right positive), d}
    project(x, y) {
      let best = { s: 0, lat: 0, d: Infinity };
      for (let i = 0; i < this.pts.length - 1; i++) {
        const a = this.pts[i], b = this.pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const L2 = dx * dx + dy * dy || 1e-6;
        let t = ((x - a.x) * dx + (y - a.y) * dy) / L2;
        t = U.clamp(t, 0, 1);
        const px = a.x + dx * t, py = a.y + dy * t;
        const d = Math.hypot(x - px, y - py);
        if (d < best.d) {
          const L = Math.sqrt(L2);
          // right normal of (dx,dy) is (dy,-dx)
          const lat = ((x - px) * dy - (y - py) * dx) / L;
          best = { s: this.cum[i] + t * L, lat, d };
        }
      }
      return best;
    }
  }
  U.Polyline = Polyline;

  U.bezier2 = function (p0, p1, p2, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, mt = 1 - t;
      pts.push({ x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x, y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y });
    }
    return pts;
  };
  U.bezier3 = function (p0, p1, p2, p3, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, mt = 1 - t;
      const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
      pts.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
    }
    return pts;
  };
  U.arc = function (cx, cy, r, a0, a1, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
    return pts;
  };
  // Intersection of two lines p + t*d
  U.lineIntersect = function (p, d, q, e) {
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den;
    return { x: p.x + d.x * t, y: p.y + d.y * t };
  };

  /* Oriented-box overlap (SAT). Box: {x, y, h (heading), hl (half length), hw (half width)} */
  U.obbOverlap = function (a, b) {
    const axes = [
      { x: Math.cos(a.h), y: Math.sin(a.h) }, { x: -Math.sin(a.h), y: Math.cos(a.h) },
      { x: Math.cos(b.h), y: Math.sin(b.h) }, { x: -Math.sin(b.h), y: Math.cos(b.h) },
    ];
    const dx = b.x - a.x, dy = b.y - a.y;
    for (const ax of axes) {
      const ra = a.hl * Math.abs(Math.cos(a.h) * ax.x + Math.sin(a.h) * ax.y) + a.hw * Math.abs(-Math.sin(a.h) * ax.x + Math.cos(a.h) * ax.y);
      const rb = b.hl * Math.abs(Math.cos(b.h) * ax.x + Math.sin(b.h) * ax.y) + b.hw * Math.abs(-Math.sin(b.h) * ax.x + Math.cos(b.h) * ax.y);
      if (Math.abs(dx * ax.x + dy * ax.y) > ra + rb) return false;
    }
    return true;
  };
  U.boxCorners = function (b) {
    const c = Math.cos(b.h), s = Math.sin(b.h);
    const out = [];
    for (const [l, w] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      out.push({ x: b.x + c * b.hl * l - s * b.hw * w, y: b.y + s * b.hl * l + c * b.hw * w });
    }
    return out;
  };
  U.pointInRect = (p, r) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

  // Express point p in a local frame at (ox,oy) with heading h → {f (forward), r (right)}
  U.toLocal = function (px, py, ox, oy, h) {
    const dx = px - ox, dy = py - oy, c = Math.cos(h), s = Math.sin(h);
    return { f: dx * c + dy * s, r: dx * s - dy * c };
  };

  DS.U = U;

  /* Tiny event bus */
  DS.Bus = {
    h: {},
    on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); },
    emit(ev, a) { (this.h[ev] || []).forEach((f) => f(a)); },
    clear() { this.h = {}; },
  };
})();
