/* Geometry batching helper and detailed low-poly vehicle models.
 * Models face +X (length), +Y up, +Z = the vehicle's right side.
 * Bodies are extruded side profiles (sculpted hood, raked windshield, wheel arches) with PBR paint,
 * reflective glass, a merged trim mesh, one vertex-coloured lamp mesh per vehicle (cheap to animate)
 * and individually steered, spinning wheels.
 */
(function () {
  'use strict';
  const DS = window.DS;

  // sRGB hex -> linear colour (the renderer outputs sRGB with ACES tone mapping)
  DS.lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

  // Collects coloured parts and merges them into one BufferGeometry (one draw call)
  class GeoBatch {
    constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; }
    _push(x, y, z, nx, ny, nz, c, u, v) { this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.col.push(c.r, c.g, c.b); this.uv.push(u, v); }
    addGeo(geo, matrix, color, uvScale) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      g.applyMatrix4(matrix);
      const p = g.attributes.position.array, n = g.attributes.normal.array, uv = g.attributes.uv ? g.attributes.uv.array : null;
      const c = DS.lin(color);
      const su = uvScale ? uvScale[0] : 1, sv = uvScale ? uvScale[1] : 1;
      for (let i = 0, j = 0; i < p.length; i += 3, j += 2) this._push(p[i], p[i + 1], p[i + 2], n[i], n[i + 1], n[i + 2], c, uv ? uv[j] * su : 0, uv ? uv[j + 1] * sv : 0);
      g.dispose();
    }
    box(x, y, z, sx, sy, sz, color, rotY, uvScale) {
      const m = new THREE.Matrix4().makeRotationY(rotY || 0);
      m.setPosition(x, y, z);
      m.multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
      this.addGeo(DS.Models.unitBox, m, color, uvScale);
    }
    boxR(x, y, z, sx, sy, sz, color, rx, ry, rz) {
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
      m.setPosition(x, y, z);
      m.multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
      this.addGeo(DS.Models.unitBox, m, color);
    }
    cyl(x, y, z, r, h, color, axis, seg, rTop) {
      const geo = new THREE.CylinderGeometry(rTop !== undefined ? rTop : r, r, h, seg || 12);
      const m = new THREE.Matrix4();
      if (axis === 'z') m.makeRotationX(Math.PI / 2); else if (axis === 'x') m.makeRotationZ(Math.PI / 2);
      m.setPosition(x, y, z);
      this.addGeo(geo, m, color);
      geo.dispose();
    }
    geo(geo, x, y, z, color, rx, ry, rz, s) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)), new THREE.Vector3(...(s || [1, 1, 1])));
      this.addGeo(geo, m, color);
    }
    // flat quad on the ground (world XY), centre (cx, cy), length along heading, width across, height above ground
    ground(cx, cy, len, wid, heading, h, color) {
      const c = Math.cos(heading), s = Math.sin(heading);
      const hl = len / 2, hw = wid / 2;
      const pts = [[hl, hw], [-hl, hw], [-hl, -hw], [hl, -hw]].map(([a, b]) => [cx + c * a - s * b, cy + s * a + c * b]);
      const col = DS.lin(color);
      for (const p of [pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]]) this._push(p[0], h, -p[1], 0, 1, 0, col, p[0] / 8, p[1] / 8);
    }
    groundPoly(ptsWorld, h, color) {
      const col = DS.lin(color);
      for (let i = 1; i < ptsWorld.length - 1; i++) for (const p of [ptsWorld[0], ptsWorld[i], ptsWorld[i + 1]]) this._push(p.x, h, -p.y, 0, 1, 0, col, p.x / 8, p.y / 8);
    }
    ribbon(pts, width, h, color, offset) {
      const col = DS.lin(color), o = offset || 0, L = [], R = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
        L.push({ x: pts[i].x + dy * (o - width / 2), y: pts[i].y - dx * (o - width / 2) });
        R.push({ x: pts[i].x + dy * (o + width / 2), y: pts[i].y - dx * (o + width / 2) });
      }
      for (let i = 0; i < pts.length - 1; i++) for (const p of [L[i], R[i], R[i + 1], L[i], R[i + 1], L[i + 1]]) this._push(p.x, h, -p.y, 0, 1, 0, col, p.x / 8, p.y / 8);
    }
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.computeBoundingSphere();
      return g;
    }
    // opts: { cast, receive, dynamic }
    build(material, opts) {
      opts = opts || {};
      const m = new THREE.Mesh(this.geometry(), material);
      if (!opts.dynamic) { m.matrixAutoUpdate = false; m.updateMatrix(); }
      m.castShadow = !!opts.cast; m.receiveShadow = !!opts.receive;
      return m;
    }
    get empty() { return this.pos.length === 0; }
  }

  /* Lamp lenses of one vehicle in a single vertex-coloured mesh; set(name, hex) recolours a group. */
  class LampSet {
    constructor() { this.b = new GeoBatch(); this.parts = {}; this.last = {}; }
    add(name, x, y, z, sx, sy, sz) {
      const start = this.b.pos.length / 3;
      this.b.box(x, y, z, sx, sy, sz, 0x222222);
      (this.parts[name] = this.parts[name] || []).push([start, this.b.pos.length / 3]);
    }
    build() {
      this.mesh = this.b.build(DS.Models.lampMat, { dynamic: true });
      this.attr = this.mesh.geometry.attributes.color;
      this.b = null;
      return this.mesh;
    }
    has(name) { return !!this.parts[name]; }
    set(name, hex) {
      const ranges = this.parts[name];
      if (!ranges || this.last[name] === hex) return;
      this.last[name] = hex;
      const c = DS.lin(hex), a = this.attr.array;
      for (const [s, e] of ranges) for (let i = s; i < e; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      this.attr.needsUpdate = true;
    }
  }

  // side profile (x along the vehicle, y up), extruded across the width with rounded edges
  function extrude(pts, width, bevel) {
    const sh = new THREE.Shape();
    pts.forEach((p, i) => (i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])));
    const b = bevel === undefined ? 0.05 : bevel;
    const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.01, width - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.8, bevelSegments: 2, curveSegments: 4 });
    g.translate(0, 0, -Math.max(0.01, width - 2 * b) / 2);
    g.computeVertexNormals();
    return g;
  }
  // bottom edge with wheel arches
  function archEdge(x0, x1, y, xs, r) {
    const pts = [[x0, y]];
    for (const xw of [...xs].sort((a, b) => a - b)) {
      pts.push([xw - r, y]);
      for (let i = 1; i < 8; i++) { const a = Math.PI - (i / 8) * Math.PI; pts.push([xw + Math.cos(a) * r, y - 0.02 + Math.sin(a) * r]); }
      pts.push([xw + r, y]);
    }
    pts.push([x1, y]);
    return pts;
  }
  function roundRect(x0, x1, y0, y1, r) {
    const pts = [], seg = 4;
    const corner = (cx, cy, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
    corner(x1 - r, y0 + r, -Math.PI / 2); corner(x1 - r, y1 - r, 0); corner(x0 + r, y1 - r, Math.PI / 2); corner(x0 + r, y0 + r, Math.PI);
    return pts;
  }
  DS.extrudeProfile = extrude;

  const geoCache = new Map();
  const cached = (key, fn) => { if (!geoCache.has(key)) geoCache.set(key, fn()); return geoCache.get(key); };

  // passenger-car style bodies: body profile, glass greenhouse, roof cap, B-pillar position
  const CAR = {
    sedan: { L: 4.6, r: 0.33, wx: [1.38, -1.4], bot: 0.3,
      body: (h) => [...archEdge(-h + 0.05, h - 0.06, 0.3, [1.38, -1.4], 0.42), [h + 0.02, 0.45], [h, 0.66], [h - 0.18, 0.8], [0.85, 0.97], [-1.3, 1.0], [-h + 0.35, 0.99], [-h + 0.02, 0.86], [-h - 0.02, 0.5]],
      cabin: [[0.85, 0.96], [-0.02, 1.4], [-0.98, 1.41], [-1.42, 0.99]], roof: [[0.02, 1.38], [-0.05, 1.45], [-0.95, 1.45], [-1.02, 1.38]], bpil: -0.45, tail: 0.86 },
    suv: { L: 4.9, r: 0.38, wx: [1.5, -1.5], bot: 0.38,
      body: (h) => [...archEdge(-h + 0.05, h - 0.06, 0.38, [1.5, -1.5], 0.47), [h + 0.02, 0.55], [h, 0.82], [h - 0.15, 0.98], [1.0, 1.12], [-h + 0.15, 1.15], [-h - 0.02, 1.05], [-h - 0.03, 0.55]],
      cabin: [[1.0, 1.11], [0.25, 1.72], [-2.2, 1.74], [-2.4, 1.14]], roof: [[0.25, 1.7], [0.2, 1.78], [-2.2, 1.78], [-2.25, 1.7]], bpil: -0.55, tail: 1.05 },
    van: { L: 5.6, r: 0.38, wx: [1.85, -1.8], bot: 0.38,
      body: (h) => [...archEdge(-h + 0.05, h - 0.06, 0.38, [1.85, -1.8], 0.47), [h + 0.02, 0.55], [h, 0.95], [h - 0.35, 1.15], [h - 0.6, 1.2], [-h + 0.05, 1.22], [-h - 0.02, 0.5]],
      cabin: [[2.2, 1.19], [1.45, 2.05], [-2.75, 2.12], [-2.8, 1.2]], roof: [[1.45, 2.03], [1.4, 2.25], [-2.78, 2.25], [-2.8, 2.05]], bpil: 0.95, panel: true, tail: 1.1 },
  };
  CAR.car = CAR.sedan; CAR.taxi = CAR.sedan; CAR.police = CAR.sedan; CAR.ambulance = CAR.van;

  const M = {
    unitBox: null,
    init() {
      this.unitBox = new THREE.BoxGeometry(1, 1, 1);
      this.trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
      this.glassMat = new THREE.MeshStandardMaterial({ color: DS.lin(0x10171f), roughness: 0.04, metalness: 0.92, transparent: true, opacity: 0.84, envMapIntensity: 1.5 });
      this.lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
      this.paints = new Map();
    },
    paint(hex) {
      if (!this.paints.has(hex)) this.paints.set(hex, new THREE.MeshStandardMaterial({ color: DS.lin(hex), metalness: 0.55, roughness: 0.3, envMapIntensity: 1.0 }));
      return this.paints.get(hex);
    },
    // tyre + alloy rim with spokes (spokes make the rotation visible)
    wheelGeo(r, w) {
      return cached('wheel' + r + w, () => {
        const b = new GeoBatch();
        b.cyl(0, 0, 0, r, w, 0x141414, 'z', 20);
        b.cyl(0, 0, w / 2 + 0.003, r * 0.64, 0.02, 0xb8bcc2, 'z', 18);
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; b.boxR(Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32, w / 2 + 0.016, r * 0.6, r * 0.13, 0.014, 0x5c6168, 0, 0, a); }
        b.cyl(0, 0, w / 2 + 0.024, r * 0.15, 0.02, 0x2a2d31, 'z', 10);
        b.cyl(0, 0, -w / 2 - 0.003, r * 0.6, 0.02, 0x3a3d42, 'z', 12);
        return b.geometry();
      });
    },
    addWheels(m, xs, r, W) {
      m.wheels = [];
      const front = Math.max(...xs);
      for (const x of xs) for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(x, r, side * (W / 2 - 0.15));
        const wm = new THREE.Mesh(this.wheelGeo(r, 0.25), this.trimMat);
        if (side < 0) wm.rotation.y = Math.PI; // rim faces outward
        const spin = new THREE.Group(); spin.add(wm);
        pivot.add(spin);
        m.group.add(pivot);
        m.wheels.push({ pivot, spin, front: x === front, r, side });
      }
    },
    glow(m, name, x, y, z, size) { m.glows.push({ name, p: new THREE.Vector3(x, y, z), size: size || 1 }); },

    // returns { group, lamps, wheels, parts, glows }
    vehicle(type, color) {
      const m = { group: new THREE.Group(), parts: {}, glows: [], type, lamps: new LampSet() };
      if (type === 'bike') return this.bike(m, color);
      if (type === 'streetcar') return this.streetcar(m, color);
      if (type === 'schoolbus') return this.schoolbus(m, color);
      if (type === 'truck' || type === 'fire') return this.truck(m, type, color);
      return this.car(m, type, color);
    },

    car(m, type, color) {
      const T = DS.VTYPES[type] || DS.VTYPES.car, lamps = m.lamps;
      const spec = CAR[type] || CAR.sedan;
      const L = T.len, W = T.wid, h = L / 2, sx = L / spec.L;
      const X = (pts) => pts.map(([x, y]) => [x * sx, y]);
      const paint = type === 'police' ? 0x15171a : color;
      const body = new THREE.Mesh(cached('body' + type, () => extrude(X(spec.body(spec.L / 2)), W, 0.06)), this.paint(paint));
      body.castShadow = true; m.group.add(body);
      m.group.add(new THREE.Mesh(cached('cab' + type, () => extrude(X(spec.cabin), W * 0.86, 0.04)), this.glassMat));
      const roof = new THREE.Mesh(cached('roof' + type, () => extrude(X(spec.roof), W * 0.88, 0.04)), this.paint(type === 'police' ? 0xf5f5f5 : paint));
      roof.castShadow = true; m.group.add(roof);
      // trim: bumpers, grille, plates, skirts, mirrors, pillar, livery
      const t = new GeoBatch(), yB = spec.bot;
      t.box(h - 0.02, yB + 0.16, 0, 0.18, 0.24, W - 0.05, 0x24272b);
      t.box(-h + 0.02, yB + 0.16, 0, 0.18, 0.24, W - 0.05, 0x24272b);
      t.box(h + 0.03, yB + 0.37, 0, 0.05, 0.17, W * 0.44, 0x0b0d0f);
      for (let i = 0; i < 3; i++) t.box(h + 0.06, yB + 0.31 + i * 0.055, 0, 0.012, 0.014, W * 0.42, 0xa9afb6);
      t.box(h + 0.075, yB + 0.17, 0, 0.02, 0.15, 0.52, 0xf4f4f4); t.box(h + 0.087, yB + 0.225, 0, 0.012, 0.025, 0.5, 0x1f4aa8);
      t.box(-h - 0.06, spec.tail - 0.42, 0, 0.02, 0.15, 0.52, 0xf4f4f4); t.box(-h - 0.072, spec.tail - 0.365, 0, 0.012, 0.025, 0.5, 0x1f4aa8);
      t.box(0, yB + 0.07, 0, L - 1.3, 0.12, W - 0.01, 0x1b1d20);
      const mx = (spec.cabin[0][0] - 0.12) * sx, my = spec.cabin[0][1] + 0.06;
      for (const s of [-1, 1]) { t.box(mx, my, s * (W / 2 + 0.11), 0.2, 0.13, 0.2, paint); t.box(mx - 0.105, my, s * (W / 2 + 0.17), 0.01, 0.1, 0.13, 0x9fb3c5); }
      t.box(spec.bpil * sx, (spec.cabin[0][1] + spec.roof[0][1]) / 2, 0, 0.12, spec.roof[0][1] - spec.cabin[0][1] - 0.04, W * 0.875, 0x15171a);
      if (spec.panel) t.box(-0.55 * sx, (spec.cabin[0][1] + spec.roof[0][1]) / 2, 0, L * 0.52, spec.roof[0][1] - spec.cabin[0][1] - 0.05, W * 0.875, type === 'ambulance' ? 0xf2f2f2 : color);
      if (type === 'taxi') { t.box(-0.45, spec.roof[1][1] + 0.12, 0, 0.55, 0.2, 0.95, 0xfff6c8); t.box(-0.45, spec.roof[1][1] + 0.025, 0, 0.6, 0.05, 1.0, 0x111111); for (const s of [-1, 1]) t.box(-0.2, 0.62, s * (W / 2 + 0.005), 1.6, 0.06, 0.01, 0x111111); }
      if (type === 'police') { t.box(-0.15, 0.72, 0, L * 0.42, 0.44, W + 0.03, 0xf5f5f5); t.box(-0.1, 0.48, 0, L * 0.96, 0.07, W + 0.035, 0x1f4aa8); t.box(-0.45, spec.roof[1][1] + 0.05, 0, 0.34, 0.08, 1.25, 0x202225); }
      if (type === 'ambulance') { t.box(0, 1.0, 0, L + 0.02, 0.24, W + 0.03, 0xc8102e); t.box(-0.9, 1.75, 0, 1.0, 0.36, W + 0.03, 0xc8102e); t.box(1.0, spec.roof[1][1] + 0.05, 0, 0.34, 0.1, 1.5, 0x202225); }
      const tm = t.build(this.trimMat, { dynamic: true }); tm.castShadow = true; m.group.add(tm);
      // lamps + glow anchors
      const hy = yB + 0.45, ry = spec.tail - 0.12;
      for (const s of [-1, 1]) {
        const sig = s < 0 ? 'sigL' : 'sigR';
        lamps.add('head', h - 0.01, hy, s * W * 0.34, 0.07, 0.13, 0.38);
        lamps.add('drl', h - 0.005, hy + 0.08, s * W * 0.34, 0.07, 0.025, 0.36);
        lamps.add(sig, h - 0.03, hy - 0.02, s * W * 0.47, 0.07, 0.1, 0.1);
        lamps.add('brake', -h - 0.01, ry, s * W * 0.36, 0.05, 0.14, 0.34);
        lamps.add(sig, -h - 0.012, ry - 0.12, s * W * 0.4, 0.05, 0.08, 0.2);
        lamps.add('reverse', -h - 0.014, ry - 0.12, s * W * 0.24, 0.04, 0.07, 0.1);
        lamps.add(sig, mx, my - 0.035, s * (W / 2 + 0.215), 0.12, 0.025, 0.02);
        this.glow(m, 'head', h + 0.06, hy, s * W * 0.34, 1.4);
        this.glow(m, 'brake', -h - 0.06, ry, s * W * 0.36, 0.9);
        this.glow(m, sig, h + 0.04, hy - 0.02, s * W * 0.47, 0.75);
        this.glow(m, sig, -h - 0.06, ry - 0.12, s * W * 0.4, 0.75);
      }
      lamps.add('brake', (spec.roof[2][0] - 0.05) * sx, spec.roof[0][1] - 0.05, 0, 0.04, 0.04, 0.5);
      if (type === 'police' || type === 'ambulance') {
        const top = spec.roof[1][1] + 0.12, x = type === 'police' ? -0.45 : 1.0;
        lamps.add('beaconA', x, top, -0.35, 0.26, 0.1, 0.5); lamps.add('beaconB', x, top, 0.35, 0.26, 0.1, 0.5);
        this.glow(m, 'beaconA', x, top + 0.08, -0.4, 2.6); this.glow(m, 'beaconB', x, top + 0.08, 0.4, 2.6);
        if (type === 'ambulance') { lamps.add('beaconA', -h - 0.01, 2.0, 0.8, 0.04, 0.2, 0.2); lamps.add('beaconB', -h - 0.01, 2.0, -0.8, 0.04, 0.2, 0.2); }
      }
      m.group.add(lamps.build());
      this.addWheels(m, [spec.wx[0] * sx, spec.wx[1] * sx], spec.r, W);
      return m;
    },

    truck(m, type, color) {
      const T = DS.VTYPES[type], L = T.len, W = T.wid, h = L / 2, lamps = m.lamps, fire = type === 'fire';
      const cabL = 2.5;
      const cab = new THREE.Mesh(cached('tcab' + type, () => extrude(roundRect(h - cabL, h, 0.55, 3.0, 0.25), W, 0.05)), this.paint(fire ? color : 0xf2f2f2));
      cab.castShadow = true; m.group.add(cab);
      const box = new THREE.Mesh(cached('tbox' + type, () => extrude(roundRect(-h, h - cabL - 0.15, 0.7, fire ? 2.9 : 3.6, 0.08), W, 0.03)), this.paint(color));
      box.castShadow = true; m.group.add(box);
      m.group.add(new THREE.Mesh(cached('tglass' + type, () => extrude([[h + 0.012, 1.85], [h + 0.012, 2.7], [h - 0.6, 2.85], [h - 0.6, 1.85]], W - 0.08, 0.02)), this.glassMat));
      const t = new GeoBatch();
      t.box(h + 0.04, 0.85, 0, 0.14, 0.36, W, 0x2a2d31); t.box(h + 0.05, 1.3, 0, 0.04, 0.5, W * 0.6, 0x0b0d0f);
      for (let i = 0; i < 4; i++) t.box(h + 0.075, 1.12 + i * 0.12, 0, 0.012, 0.03, W * 0.58, 0xb0b5bb);
      t.box(0, 0.55, 0, L - 0.4, 0.28, W - 0.3, 0x1b1d20);
      for (const s of [-1, 1]) t.box(h - 0.4, 2.15, s * (W / 2 + 0.16), 0.08, 0.5, 0.18, 0x1b1d20);
      if (fire) { t.box(-0.8, 3.05, 0, L - cabL - 1.2, 0.12, 0.7, 0xd0d4d8); t.box(-0.8, 1.65, 0, L - cabL, 0.18, W + 0.02, 0xf5f5f5); for (let i = 0; i < 5; i++) for (const s of [-1, 1]) t.box(-h + 0.6 + i * 1.2, 2.05, s * (W / 2 + 0.01), 1.0, 0.75, 0.02, 0xb5b9be); }
      else for (const s of [-1, 1]) t.box(-1.2, 2.2, s * (W / 2 + 0.01), L - cabL - 1.2, 0.6, 0.02, 0x1f4aa8);
      const tm = t.build(this.trimMat, { dynamic: true }); tm.castShadow = true; m.group.add(tm);
      for (const s of [-1, 1]) {
        const sig = s < 0 ? 'sigL' : 'sigR';
        lamps.add('head', h + 0.1, 0.95, s * W * 0.36, 0.05, 0.18, 0.34);
        lamps.add(sig, h + 0.1, 1.2, s * W * 0.44, 0.05, 0.12, 0.12);
        lamps.add('brake', -h - 0.02, 0.95, s * W * 0.4, 0.05, 0.22, 0.25);
        lamps.add(sig, -h - 0.02, 1.2, s * W * 0.4, 0.05, 0.14, 0.2);
        this.glow(m, 'head', h + 0.15, 0.95, s * W * 0.36, 1.6); this.glow(m, 'brake', -h - 0.08, 0.95, s * W * 0.4, 1.1);
        this.glow(m, sig, h + 0.15, 1.2, s * W * 0.44, 0.9); this.glow(m, sig, -h - 0.08, 1.2, s * W * 0.4, 0.9);
      }
      for (let i = 0; i < 5; i++) lamps.add('marker', h - cabL + 0.3 + (i - 2) * 0.25, 3.05, 0, 0.08, 0.06, 0.08);
      if (fire) {
        lamps.add('beaconA', h - 0.6, 3.1, -0.6, 0.3, 0.14, 0.55); lamps.add('beaconB', h - 0.6, 3.1, 0.6, 0.3, 0.14, 0.55);
        lamps.add('beaconA', -h - 0.02, 2.6, 0.9, 0.05, 0.25, 0.25); lamps.add('beaconB', -h - 0.02, 2.6, -0.9, 0.05, 0.25, 0.25);
        this.glow(m, 'beaconA', h - 0.6, 3.25, -0.6, 2.8); this.glow(m, 'beaconB', h - 0.6, 3.25, 0.6, 2.8);
      }
      m.group.add(lamps.build());
      this.addWheels(m, [h - 1.25, -h + 2.3, -h + 1.15], 0.5, W);
      return m;
    },

    schoolbus(m, color) {
      const T = DS.VTYPES.schoolbus, L = T.len, W = T.wid, h = L / 2, lamps = m.lamps;
      const body = new THREE.Mesh(cached('busbody', () => extrude([...archEdge(-h, h - 1.6, 0.5, [h - 2.6, -h + 2.4], 0.6), [h - 1.6, 0.5], [h + 0.05, 0.55], [h + 0.08, 1.35], [h - 1.5, 1.55], [h - 1.62, 3.0], [h - 1.75, 3.1], [-h + 0.15, 3.12], [-h, 2.95]], W, 0.08)), this.paint(color));
      body.castShadow = true; m.group.add(body);
      m.group.add(new THREE.Mesh(cached('busglass', () => extrude([[h - 1.5, 1.95], [h - 1.62, 2.85], [-h + 0.25, 2.85], [-h + 0.25, 1.95]], W + 0.04, 0)), this.glassMat));
      const t = new GeoBatch();
      for (const y of [1.3, 1.7]) t.box(-0.85, y, 0, L - 1.9, 0.09, W + 0.1, 0x111111);
      for (let i = 0; i < 8; i++) t.box(h - 2.4 - i * 1.15, 2.4, 0, 0.12, 0.92, W + 0.06, color);
      t.box(h + 0.1, 0.62, 0, 0.18, 0.28, W, 0x111111);
      t.box(h + 0.1, 1.05, 0, 0.03, 0.4, W * 0.55, 0x0b0d0f);
      t.box(h - 1.5, 2.1, W / 2 + 0.03, 0.9, 1.8, 0.03, 0x2b2f35); // door
      for (const s of [-1, 1]) { t.box(h - 1.3, 2.0, s * (W / 2 + 0.32), 0.06, 0.45, 0.3, 0x111111); t.box(h - 1.4, 2.0, s * (W / 2 + 0.15), 0.04, 0.04, 0.36, 0x111111); }
      t.box(-h - 0.01, 1.2, 0, 0.02, 0.5, W - 0.2, 0x111111);
      const tm = t.build(this.trimMat, { dynamic: true }); tm.castShadow = true; m.group.add(tm);
      const sg = new THREE.MeshBasicMaterial({ map: DS.Tex.get('schoolbus') });
      for (const [x, ry] of [[h - 1.69, Math.PI / 2], [-h - 0.06, -Math.PI / 2]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.26), sg); p.position.set(x, 2.98, 0); p.rotation.y = ry; m.group.add(p); }
      // stop arm on the driver's (left, -Z) side; folded = rotation.y PI/2, extended = 0
      const armPivot = new THREE.Group();
      armPivot.position.set(h - 2.8, 1.85, -W / 2 - 0.05);
      const arm = new THREE.Mesh(new THREE.CircleGeometry(0.33, 8), new THREE.MeshBasicMaterial({ map: DS.Tex.get('stopRound'), side: THREE.DoubleSide, toneMapped: false }));
      arm.position.set(0, 0, -0.4); arm.rotation.y = Math.PI / 2; arm.rotation.z = Math.PI / 8;
      armPivot.add(arm);
      armPivot.rotation.y = Math.PI / 2;
      m.group.add(armPivot); m.parts.stopArm = armPivot;
      for (const [x, f] of [[h - 1.58, 1], [-h - 0.05, -1]]) for (const s of [-1, 1]) {
        const red = s < 0 ? 'busRedA' : 'busRedB';
        lamps.add(red, x, 2.98, s * 0.98, 0.06, 0.22, 0.22);
        lamps.add('busAmb', x, 2.98, s * 0.62, 0.06, 0.18, 0.18);
        this.glow(m, red, x + f * 0.1, 2.98, s * 0.98, 2.0); this.glow(m, 'busAmb', x + f * 0.1, 2.98, s * 0.62, 1.6);
      }
      for (const s of [-1, 1]) {
        const sig = s < 0 ? 'sigL' : 'sigR';
        lamps.add('head', h + 0.1, 1.0, s * 0.9, 0.05, 0.18, 0.3);
        lamps.add('brake', -h - 0.02, 1.0, s * 1.0, 0.05, 0.25, 0.25);
        lamps.add(sig, h + 0.1, 1.25, s * 1.1, 0.05, 0.14, 0.14);
        lamps.add(sig, -h - 0.02, 1.3, s * 1.0, 0.05, 0.16, 0.2);
        this.glow(m, 'head', h + 0.15, 1.0, s * 0.9, 1.5); this.glow(m, 'brake', -h - 0.08, 1.0, s * 1.0, 1.1);
        this.glow(m, sig, h + 0.15, 1.25, s * 1.1, 0.9); this.glow(m, sig, -h - 0.08, 1.3, s * 1.0, 0.9);
      }
      m.group.add(lamps.build());
      this.addWheels(m, [h - 2.6, -h + 2.4], 0.5, W);
      return m;
    },

    // TTC Flexity-style articulated streetcar, pantograph reaching the overhead wire
    streetcar(m, color) {
      const T = DS.VTYPES.streetcar, L = T.len, W = T.wid, h = L / 2, lamps = m.lamps;
      const secs = 3, gap = 0.5, sl = (L - gap * (secs - 1)) / secs;
      const t = new GeoBatch();
      for (let i = 0; i < secs; i++) {
        const x0 = -h + i * (sl + gap), x1 = x0 + sl;
        const n0 = i === 0 ? 0.7 : 0, n1 = i === secs - 1 ? 0.7 : 0;
        const body = new THREE.Mesh(cached('scb' + i, () => extrude([[x0 + n0, 0.35], [x1 - n1, 0.35], [x1, 0.9], [x1, 2.4], [x1 - n1 * 0.6, 3.25], [x0 + n0 * 0.6, 3.25], [x0, 2.4], [x0, 0.9]], W, 0.07)), this.paint(0xf1f1f1));
        body.castShadow = true; m.group.add(body);
        m.group.add(new THREE.Mesh(cached('scr' + i, () => extrude([[x0 + n0 * 0.9, 0.33], [x1 - n1 * 0.9, 0.33], [x1 + 0.012, 0.9], [x1 + 0.012, 1.4], [x0 - 0.012, 1.4], [x0 - 0.012, 0.9]], W + 0.03, 0.02)), this.paint(color)));
        m.group.add(new THREE.Mesh(cached('scw' + i, () => extrude([[x0 + 0.12, 1.55], [x1 - 0.12, 1.55], [x1 - 0.12 - n1 * 0.35, 2.78], [x0 + 0.12 + n0 * 0.35, 2.78]], W + 0.045, 0)), this.glassMat));
        if (i < secs - 1) t.box(x1 + gap / 2, 1.8, 0, gap + 0.12, 2.6, W - 0.35, 0x1b1d20);
        t.box((x0 + x1) / 2, 0.3, 0, sl - 1.2, 0.3, W - 0.3, 0x1b1d20);
        t.box((x0 + x1) / 2, 3.32, 0, sl - 2, 0.15, W - 0.5, 0x3a3d42);
        t.box((x0 + x1) / 2, 2.95, 0, sl - n0 - n1, 0.06, W + 0.05, color); // red roof stripe
      }
      const px = -h + sl + gap + sl / 2;
      t.box(px, 3.45, 0, 1.8, 0.12, 1.0, 0x2a2d31);
      t.boxR(px - 0.45, 4.15, 0, 0.06, 1.55, 0.06, 0x2a2d31, 0, 0, 0.75);
      t.boxR(px + 0.15, 5.05, 0, 0.06, 1.35, 0.06, 0x2a2d31, 0, 0, -0.75);
      t.box(px + 0.55, 5.78, 0, 0.12, 0.05, 1.3, 0x5a5d62);
      for (const x of [h - 0.4, -h + 0.4]) t.box(x, 0.35, 0, 1.4, 0.4, W - 0.2, 0x111111);
      const tm = t.build(this.trimMat, { dynamic: true }); tm.castShadow = true; m.group.add(tm);
      const sign = new THREE.MeshBasicMaterial({ map: DS.Tex.get('destination'), toneMapped: false });
      for (const [x, ry] of [[h + 0.04, Math.PI / 2], [-h - 0.04, -Math.PI / 2]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 0.26), sign); p.position.set(x, 2.9, 0); p.rotation.y = ry; m.group.add(p); }
      // sliding doors on the right (+Z) side
      m.parts.doors = [];
      const doorMat = new THREE.MeshStandardMaterial({ color: DS.lin(0x2b2f35), metalness: 0.5, roughness: 0.3 });
      for (const dx of [-4, -13, -22]) {
        const x = h + dx;
        for (const s of [-1, 1]) {
          const d = new THREE.Mesh(this.unitBox, doorMat);
          d.position.set(x + s * 0.47, 1.65, W / 2 + 0.06); d.scale.set(0.92, 2.4, 0.05);
          d.userData.closedX = d.position.x; d.userData.dir = s;
          m.group.add(d); m.parts.doors.push(d);
        }
        lamps.add('doorLamp', x, 2.98, W / 2 + 0.07, 1.8, 0.06, 0.03);
        this.glow(m, 'doorLamp', x, 2.98, W / 2 + 0.1, 1.2);
      }
      for (const [x, f] of [[h + 0.02, 1], [-h - 0.02, -1]]) for (const s of [-1, 1]) {
        const sig = s < 0 ? 'sigL' : 'sigR';
        lamps.add(f > 0 ? 'head' : 'brake', x, 1.05, s * 0.85, 0.04, 0.2, 0.35);
        lamps.add(sig, x, 1.4, s * 1.15, 0.04, 0.12, 0.15);
        this.glow(m, f > 0 ? 'head' : 'brake', x + f * 0.08, 1.05, s * 0.85, 1.4);
        this.glow(m, sig, x + f * 0.08, 1.4, s * 1.15, 0.8);
      }
      m.group.add(lamps.build());
      m.wheels = [];
      return m;
    },

    bike(m, color) {
      const b = new GeoBatch();
      b.box(0, 0.6, 0, 1.0, 0.05, 0.05, color); b.boxR(0.35, 0.5, 0, 0.05, 0.5, 0.05, color, 0, 0, 0.35); b.boxR(-0.3, 0.55, 0, 0.05, 0.45, 0.05, color, 0, 0, -0.3);
      b.box(-0.05, 1.12, 0, 0.3, 0.6, 0.36, color);
      b.box(-0.05, 0.78, -0.1, 0.12, 0.42, 0.12, 0x26303a); b.box(-0.05, 0.78, 0.1, 0.12, 0.42, 0.12, 0x26303a);
      b.box(0.08, 1.58, 0, 0.24, 0.24, 0.22, 0xe0ac69); b.box(0.05, 1.74, 0, 0.32, 0.12, 0.28, 0xf2f2f2);
      b.boxR(0.3, 1.25, 0, 0.45, 0.06, 0.06, 0xe0ac69, 0, 0, -0.5);
      const mesh = b.build(this.trimMat, { dynamic: true }); mesh.castShadow = true;
      m.group.add(mesh);
      m.wheels = [];
      for (const x of [0.6, -0.6]) {
        const pivot = new THREE.Group(); pivot.position.set(x, 0.34, 0);
        const w = new THREE.Mesh(cached('bikewheel', () => new THREE.TorusGeometry(0.31, 0.03, 6, 18)), this.trimMat);
        const spin = new THREE.Group(); spin.add(w); pivot.add(spin); m.group.add(pivot);
        m.wheels.push({ pivot, spin, front: x > 0, r: 0.34, side: 1 });
      }
      m.lamps.add('head', 0.72, 0.95, 0, 0.04, 0.05, 0.05); m.lamps.add('brake', -0.75, 0.8, 0, 0.04, 0.05, 0.05);
      this.glow(m, 'brake', -0.78, 0.8, 0, 0.6);
      m.group.add(m.lamps.build());
      return m;
    },

    // student car + cockpit interior (shown only in the driver view)
    player() {
      const m = this.vehicle('car', 0xf4f4f4);
      m.exterior = m.group.children.slice();
      const sideMat = this.paint(0xd52b1e), face = new THREE.MeshBasicMaterial({ map: DS.Tex.get('student') });
      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.26, 0.32), [sideMat, sideMat, sideMat, sideMat, face, face]);
      sign.rotation.y = Math.PI / 2;
      sign.position.set(-0.5, 1.6, 0);
      sign.castShadow = true;
      m.group.add(sign); m.exterior.push(sign);
      const cockpit = new THREE.Group();
      const W = 1.84;
      const dark = new THREE.MeshStandardMaterial({ color: DS.lin(0x1c1e21), roughness: 0.85, metalness: 0.05 });
      const soft = new THREE.MeshStandardMaterial({ color: DS.lin(0x2c2f34), roughness: 0.9 });
      cockpit.add(new THREE.Mesh(extrude([[0.55, 0.5], [1.22, 0.5], [1.22, 0.84], [0.98, 0.9], [0.62, 0.84]], W - 0.1, 0.04), dark));
      const binnacle = new THREE.Mesh(extrude([[0.62, 0.84], [0.88, 0.89], [0.82, 0.97], [0.66, 0.96]], 0.55, 0.03), dark);
      binnacle.position.z = -0.37; cockpit.add(binnacle);
      cockpit.add(new THREE.Mesh(extrude([[1.2, 0.6], [2.3, 0.6], [2.32, 0.68], [2.12, 0.78], [1.2, 0.87]], W - 0.05, 0.05), this.paint(0xf4f4f4)));
      for (const s of [-1, 1]) {
        const pil = new THREE.Mesh(this.unitBox, dark); pil.position.set(1.0, 1.15, s * (W / 2 - 0.08)); pil.scale.set(0.06, 0.82, 0.07); pil.rotation.z = 0.9; cockpit.add(pil);
        const door = new THREE.Mesh(this.unitBox, soft); door.position.set(0.1, 0.76, s * (W / 2 - 0.02)); door.scale.set(1.6, 0.4, 0.06); cockpit.add(door);
      }
      const roof = new THREE.Mesh(this.unitBox, soft); roof.position.set(0.05, 1.42, 0); roof.scale.set(1.4, 0.04, W - 0.1); cockpit.add(roof);
      // steering wheel: rim + 3 spokes + hub; spun by steering input
      const sw = new THREE.Group();
      sw.add(new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.022, 10, 32), dark));
      for (const a of [-Math.PI / 2, Math.PI / 2 + 0.6, -Math.PI / 2 - 1.2 + Math.PI * 2]) {
        const sp = new THREE.Mesh(this.unitBox, soft); sp.scale.set(0.17, 0.035, 0.02); sp.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0); sp.rotation.z = a; sw.add(sp);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 18), soft); hub.rotation.x = Math.PI / 2; sw.add(hub);
      const mark = new THREE.Mesh(this.unitBox, new THREE.MeshBasicMaterial({ color: 0xd52b1e })); mark.scale.set(0.02, 0.03, 0.03); mark.position.set(0, 0.18, 0.01); sw.add(mark);
      const wheelPivot = new THREE.Group(); wheelPivot.position.set(0.52, 0.84, -0.37); wheelPivot.rotation.y = Math.PI / 2;
      const tilt = new THREE.Group(); tilt.rotation.x = -0.42; tilt.add(sw); wheelPivot.add(tilt);
      cockpit.add(wheelPivot);
      const rvm = new THREE.Mesh(this.unitBox, dark); rvm.position.set(0.72, 1.33, 0.05); rvm.scale.set(0.04, 0.07, 0.26); cockpit.add(rvm);
      m.group.add(cockpit);
      cockpit.visible = false;
      m.parts.cockpit = cockpit; m.parts.wheel = sw; m.parts.roofSign = sign;
      return m;
    },
  };

  DS.GeoBatch = GeoBatch;
  DS.Models = M;
})();
