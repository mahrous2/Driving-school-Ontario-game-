/* Geometry batching helper and low-poly vehicle / pedestrian models.
 * Models are built facing +X (length), +Y up, +Z = vehicle's right side.
 */
(function () {
  'use strict';
  const DS = window.DS;

  // Collects coloured parts and merges them into one BufferGeometry (one draw call)
  class GeoBatch {
    constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; this.hasUV = false; }
    addGeo(geo, matrix, color, uvScale) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      g.applyMatrix4(matrix);
      const p = g.attributes.position.array, n = g.attributes.normal.array, uv = g.attributes.uv ? g.attributes.uv.array : null;
      const c = new THREE.Color(color);
      for (let i = 0; i < p.length; i += 3) {
        this.pos.push(p[i], p[i + 1], p[i + 2]); this.nor.push(n[i], n[i + 1], n[i + 2]); this.col.push(c.r, c.g, c.b);
      }
      if (uv) for (let i = 0; i < uv.length; i += 2) this.uv.push(uv[i] * (uvScale ? uvScale[0] : 1), uv[i + 1] * (uvScale ? uvScale[1] : 1));
      else for (let i = 0; i < p.length / 3; i++) this.uv.push(0, 0);
      g.dispose();
    }
    box(x, y, z, sx, sy, sz, color, rotY, uvScale) {
      const m = new THREE.Matrix4().makeRotationY(rotY || 0);
      m.setPosition(x, y, z);
      const geo = DS.Models.unitBox;
      const s = new THREE.Matrix4().makeScale(sx, sy, sz);
      m.multiply(s);
      this.addGeo(geo, m, color, uvScale);
    }
    cyl(x, y, z, r, h, color, axis, seg) {
      const geo = new THREE.CylinderGeometry(r, r, h, seg || 10);
      const m = new THREE.Matrix4();
      if (axis === 'z') m.makeRotationX(Math.PI / 2); else if (axis === 'x') m.makeRotationZ(Math.PI / 2);
      m.setPosition(x, y, z);
      this.addGeo(geo, m, color);
      geo.dispose();
    }
    // flat quad on the ground (world XY), centre (cx, cy), length along heading, width across, height above ground
    ground(cx, cy, len, wid, heading, h, color) {
      const c = Math.cos(heading), s = Math.sin(heading);
      const hl = len / 2, hw = wid / 2;
      const pts = [[hl, hw], [-hl, hw], [-hl, -hw], [hl, -hw]].map(([a, b]) => [cx + c * a - s * b, cy + s * a + c * b]);
      // world (x,y) -> three (x, h, -y); triangles counter-clockwise seen from above
      const v = (p) => [p[0], h, -p[1]];
      const tri = [pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]];
      const col = new THREE.Color(color);
      for (const p of tri) { const q = v(p); this.pos.push(q[0], q[1], q[2]); this.nor.push(0, 1, 0); this.col.push(col.r, col.g, col.b); this.uv.push(p[0] / 8, p[1] / 8); }
    }
    groundPoly(ptsWorld, h, color) {
      // fan triangulation of a convex polygon
      const col = new THREE.Color(color);
      for (let i = 1; i < ptsWorld.length - 1; i++) {
        for (const p of [ptsWorld[0], ptsWorld[i], ptsWorld[i + 1]]) { this.pos.push(p.x, h, -p.y); this.nor.push(0, 1, 0); this.col.push(col.r, col.g, col.b); this.uv.push(p.x / 8, p.y / 8); }
      }
    }
    // ribbon along a world polyline
    ribbon(pts, width, h, color, offset) {
      const col = new THREE.Color(color);
      const o = offset || 0;
      const L = [], Rr = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
        const rx = dy, ry = -dx;
        L.push({ x: pts[i].x + rx * (o - width / 2), y: pts[i].y + ry * (o - width / 2) });
        Rr.push({ x: pts[i].x + rx * (o + width / 2), y: pts[i].y + ry * (o + width / 2) });
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const quad = [L[i], Rr[i], Rr[i + 1], L[i], Rr[i + 1], L[i + 1]];
        for (const p of quad) { this.pos.push(p.x, h, -p.y); this.nor.push(0, 1, 0); this.col.push(col.r, col.g, col.b); this.uv.push(p.x / 8, p.y / 8); }
      }
    }
    build(material) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, material);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      return m;
    }
    get empty() { return this.pos.length === 0; }
  }

  const M = {
    unitBox: null,
    init() { this.unitBox = new THREE.BoxGeometry(1, 1, 1); this.bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true }); },
    lamp(color) { return new THREE.MeshBasicMaterial({ color }); },

    // returns {group, lights:{...}, parts:{...}}
    vehicle(type, color) {
      const T = DS.VTYPES[type];
      const L = T.len, W = T.wid;
      const b = new GeoBatch();
      const glass = 0x1b2630, tire = 0x161616, trim = 0x2a2a2a;
      const g = new THREE.Group();
      const lights = {};
      const parts = {};
      const addLamp = (name, x, y, z, sx, sy, sz, col) => {
        const mat = M.lamp(col);
        const mesh = new THREE.Mesh(M.unitBox, mat);
        mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
        g.add(mesh);
        (lights[name] = lights[name] || []).push(mesh);
        return mesh;
      };
      const wheels = (r, xs) => { for (const x of xs) for (const z of [-W / 2 + 0.18, W / 2 - 0.18]) b.cyl(x, r, z, r, 0.32, tire, 'z', 12); };

      if (type === 'bike') {
        b.box(0, 0.55, 0, 1.6, 0.06, 0.06, color);
        b.cyl(0.6, 0.34, 0, 0.34, 0.05, tire, 'z', 12); b.cyl(-0.6, 0.34, 0, 0.34, 0.05, tire, 'z', 12);
        b.box(-0.1, 1.15, 0, 0.32, 0.65, 0.36, color);
        b.box(0.05, 1.62, 0, 0.24, 0.24, 0.24, 0xe0ac69);
        b.box(0.05, 1.78, 0, 0.3, 0.12, 0.3, 0x222222); // helmet
        g.add(b.build(M.bodyMat));
        return { group: g, lights, parts };
      }
      if (type === 'streetcar') {
        b.box(0, 1.0, 0, L, 1.2, W, color);
        b.box(0, 2.15, 0, L - 0.4, 1.1, W - 0.04, glass);
        b.box(0, 2.95, 0, L - 0.6, 0.5, W - 0.1, 0xf4f4f4);
        b.box(L / 2 - 0.15, 1.8, 0, 0.3, 2.6, W - 0.3, color);
        b.box(-L / 2 + 0.15, 1.8, 0, 0.3, 2.6, W - 0.3, color);
        b.box(0, 3.35, 0, 2.5, 0.12, 0.8, trim); // pantograph base
        b.box(0.3, 4.0, 0, 0.08, 1.3, 0.08, trim);
        b.box(0, 0.25, 0, L - 2, 0.5, W - 0.4, trim);
        for (const x of [-L / 2 + 2.5, -L / 6, L / 6, L / 2 - 2.5]) b.box(x, 0.35, 0, 1.6, 0.5, W - 0.2, tire);
        g.add(b.build(M.bodyMat));
        // doors on the right (+Z) side
        parts.doors = [];
        for (const dx of [-4, -13, -22]) {
          const x = L / 2 + dx;
          const door = new THREE.Mesh(M.unitBox, new THREE.MeshLambertMaterial({ color: 0xdedede }));
          door.position.set(x, 1.55, W / 2 + 0.03); door.scale.set(1.9, 2.3, 0.06);
          g.add(door); parts.doors.push(door);
        }
        addLamp('head', L / 2 + 0.01, 1.0, -0.8, 0.05, 0.2, 0.35, 0xfff5cc); addLamp('head', L / 2 + 0.01, 1.0, 0.8, 0.05, 0.2, 0.35, 0xfff5cc);
        addLamp('brake', -L / 2 - 0.01, 1.0, -0.9, 0.05, 0.2, 0.3, 0x550000); addLamp('brake', -L / 2 - 0.01, 1.0, 0.9, 0.05, 0.2, 0.3, 0x550000);
        addLamp('sigL', L / 2, 1.3, -1.1, 0.05, 0.15, 0.2, 0x553300); addLamp('sigR', L / 2, 1.3, 1.1, 0.05, 0.15, 0.2, 0x553300);
        addLamp('sigL', -L / 2, 1.3, -1.1, 0.05, 0.15, 0.2, 0x553300); addLamp('sigR', -L / 2, 1.3, 1.1, 0.05, 0.15, 0.2, 0x553300);
        return { group: g, lights, parts };
      }
      if (type === 'schoolbus') {
        b.box(-0.6, 1.75, 0, L - 1.6, 2.3, W, color);
        b.box(L / 2 - 1.0, 0.95, 0, 1.6, 1.0, W - 0.2, color); // hood
        b.box(-0.6, 2.15, 0, L - 1.7, 0.75, W + 0.02, glass);
        b.box(-0.6, 1.25, 0, L - 1.55, 0.1, W + 0.04, 0x111111);
        b.box(-0.6, 1.6, 0, L - 1.55, 0.1, W + 0.04, 0x111111);
        b.box(L / 2 - 1.8, 2.1, 0, 0.1, 0.8, W - 0.2, glass);
        b.box(L / 2 - 0.1, 0.6, 0, 0.2, 0.25, W, 0x111111);
        wheels(0.5, [L / 2 - 1.3, -L / 2 + 2.2]);
        b.box(-0.6, 0.55, 0, L - 2, 0.3, W - 0.3, trim);
        g.add(b.build(M.bodyMat));
        // stop arm on the driver's (left, -Z) side
        const armPivot = new THREE.Group();
        armPivot.position.set(L / 2 - 2.6, 1.6, -W / 2 - 0.02);
        const arm = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ map: DS.Tex.get('stop'), side: THREE.DoubleSide, transparent: true }));
        arm.position.set(0, 0, -0.34);
        arm.rotation.y = Math.PI / 2;
        armPivot.add(arm);
        g.add(armPivot);
        parts.stopArm = armPivot;
        for (const x of [L / 2 - 1.85, -L / 2 + 0.15]) {
          addLamp('busRedA', x, 2.85, -0.85, 0.12, 0.2, 0.2, 0x330000); addLamp('busRedB', x, 2.85, 0.85, 0.12, 0.2, 0.2, 0x330000);
          addLamp('busAmb', x, 2.85, -0.45, 0.12, 0.18, 0.18, 0x332200); addLamp('busAmb', x, 2.85, 0.45, 0.12, 0.18, 0.18, 0x332200);
        }
        addLamp('head', L / 2 + 0.01, 0.95, -0.85, 0.05, 0.18, 0.3, 0xfff5cc); addLamp('head', L / 2 + 0.01, 0.95, 0.85, 0.05, 0.18, 0.3, 0xfff5cc);
        addLamp('brake', -L / 2 + 0.19, 0.9, -1.0, 0.05, 0.25, 0.25, 0x550000); addLamp('brake', -L / 2 + 0.19, 0.9, 1.0, 0.05, 0.25, 0.25, 0x550000);
        addLamp('sigL', L / 2, 1.2, -1.15, 0.05, 0.15, 0.15, 0x553300); addLamp('sigR', L / 2, 1.2, 1.15, 0.05, 0.15, 0.15, 0x553300);
        addLamp('sigL', -L / 2 + 0.19, 1.25, -1.15, 0.05, 0.15, 0.15, 0x553300); addLamp('sigR', -L / 2 + 0.19, 1.25, 1.15, 0.05, 0.15, 0.15, 0x553300);
        return { group: g, lights, parts };
      }

      // generic road vehicles
      const isTruck = type === 'truck' || type === 'fire', isVan = type === 'van' || type === 'ambulance';
      if (isTruck) {
        const cabL = 2.4;
        b.box(L / 2 - cabL / 2, 1.55, 0, cabL, 2.0, W, type === 'fire' ? color : 0xf2f2f2);
        b.box(L / 2 - 0.3, 2.0, 0, 0.62, 0.8, W - 0.1, glass);
        b.box(-cabL / 2, 2.0, 0, L - cabL - 0.3, 2.9, W, type === 'fire' ? color : color);
        if (type === 'fire') { b.box(-cabL / 2, 3.5, 0, L - cabL - 1, 0.15, 0.9, 0xd0d0d0); b.box(-cabL / 2, 1.2, 0, L - cabL, 0.2, W + 0.02, 0xf2f2f2); }
        b.box(0, 0.55, 0, L - 0.6, 0.35, W - 0.3, trim);
        wheels(0.5, [L / 2 - 1.2, -L / 2 + 2.2, -L / 2 + 1.1]);
      } else if (isVan) {
        b.box(0, 1.3, 0, L, 1.9, W, color);
        b.box(L / 2 - 0.55, 1.85, 0, 1.0, 0.6, W - 0.04, glass);
        b.box(L / 2 - 0.25, 0.8, 0, 0.5, 0.9, W, color);
        if (type === 'ambulance') { b.box(0, 1.25, 0, L + 0.02, 0.3, W + 0.02, 0xc8102e); b.box(-0.6, 1.9, 0, 1.2, 0.5, W + 0.02, 0xc8102e); }
        wheels(0.38, [L / 2 - 1.0, -L / 2 + 1.0]);
      } else {
        const tall = type === 'suv';
        const bodyH = tall ? 0.85 : 0.65, cabH = tall ? 0.65 : 0.55;
        const y0 = tall ? 0.35 : 0.28;
        b.box(0, y0 + bodyH / 2, 0, L, bodyH, W, color);
        const cabL = L * (tall ? 0.6 : 0.5);
        b.box(-L * 0.06, y0 + bodyH + cabH / 2, 0, cabL, cabH, W * 0.86, glass);
        b.box(-L * 0.06, y0 + bodyH + cabH + 0.03, 0, cabL * 0.92, 0.06, W * 0.82, color);
        b.box(L / 2 - 0.02, y0 + 0.18, 0, 0.12, 0.2, W - 0.1, trim);
        b.box(-L / 2 + 0.02, y0 + 0.18, 0, 0.12, 0.2, W - 0.1, trim);
        if (type === 'taxi') b.box(-L * 0.06, y0 + bodyH + cabH + 0.2, 0, 0.5, 0.25, 0.9, 0xffffff);
        if (type === 'police') { b.box(0, y0 + bodyH / 2 + 0.05, 0, L * 0.5, bodyH * 0.6, W + 0.02, 0xffffff); }
        wheels(0.34, [L * 0.32, -L * 0.32]);
      }
      g.add(b.build(M.bodyMat));
      const hy = isTruck ? 0.9 : isVan ? 0.85 : 0.6;
      addLamp('head', L / 2 + 0.01, hy, -W * 0.33, 0.04, 0.14, 0.32, 0xfff5cc); addLamp('head', L / 2 + 0.01, hy, W * 0.33, 0.04, 0.14, 0.32, 0xfff5cc);
      addLamp('brake', -L / 2 - 0.01, hy + 0.05, -W * 0.36, 0.04, 0.16, 0.3, 0x550000); addLamp('brake', -L / 2 - 0.01, hy + 0.05, W * 0.36, 0.04, 0.16, 0.3, 0x550000);
      addLamp('sigL', L / 2 + 0.01, hy, -W * 0.47, 0.05, 0.12, 0.08, 0x553300); addLamp('sigR', L / 2 + 0.01, hy, W * 0.47, 0.05, 0.12, 0.08, 0x553300);
      addLamp('sigL', -L / 2 - 0.01, hy + 0.05, -W * 0.48, 0.05, 0.14, 0.07, 0x553300); addLamp('sigR', -L / 2 - 0.01, hy + 0.05, W * 0.48, 0.05, 0.14, 0.07, 0x553300);
      if (type === 'ambulance' || type === 'fire' || type === 'police') {
        const top = type === 'police' ? 1.62 : type === 'fire' ? 3.05 : 2.32;
        const x = type === 'police' ? -0.25 : L / 2 - 0.6;
        addLamp('beaconA', x, top, -0.45, 0.3, 0.16, 0.5, 0x330000);
        addLamp('beaconB', x, top, 0.45, 0.3, 0.16, 0.5, type === 'police' ? 0x000033 : 0x330000);
        if (type !== 'police') { addLamp('beaconA', -L / 2 + 0.3, top - 0.1, 0.8, 0.2, 0.2, 0.2, 0x330000); addLamp('beaconB', -L / 2 + 0.3, top - 0.1, -0.8, 0.2, 0.2, 0.2, 0x330000); }
      }
      return { group: g, lights, parts };
    },

    // student car + cockpit interior
    player() {
      const m = M.vehicle('car', 0xf4f4f4);
      const L = 4.6, W = 1.85;
      // "STUDENT DRIVER" roof sign
      const sign = new THREE.Mesh(M.unitBox, new THREE.MeshLambertMaterial({ color: 0xd52b1e }));
      sign.position.set(-0.3, 1.62, 0); sign.scale.set(0.25, 0.28, 1.0);
      m.group.add(sign);
      const cockpit = new THREE.Group();
      const dark = new THREE.MeshLambertMaterial({ color: 0x1d1f22 });
      const dash = new THREE.Mesh(M.unitBox, dark); dash.position.set(0.98, 0.7, 0); dash.scale.set(0.55, 0.24, W - 0.1); cockpit.add(dash);
      const hood = new THREE.Mesh(M.unitBox, new THREE.MeshLambertMaterial({ color: 0x9aa3ad })); hood.position.set(1.9, 0.78, 0); hood.scale.set(1.45, 0.05, W - 0.05); cockpit.add(hood);
      const roof = new THREE.Mesh(M.unitBox, dark); roof.position.set(0.0, 1.6, 0); roof.scale.set(1.5, 0.04, W - 0.1); cockpit.add(roof);
      for (const z of [-W / 2 + 0.1, W / 2 - 0.1]) {
        const pil = new THREE.Mesh(M.unitBox, dark); pil.position.set(1.2, 1.18, z * 1.05); pil.scale.set(0.05, 0.8, 0.05); pil.rotation.z = 0.85; cockpit.add(pil);
      }
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 24), dark);
      wheel.position.set(0.6, 0.8, -0.37); wheel.rotation.y = Math.PI / 2; wheel.rotation.x = 0;
      const wheelPivot = new THREE.Group(); wheelPivot.position.copy(wheel.position); wheel.position.set(0, 0, 0);
      const tilt = new THREE.Group(); tilt.rotation.z = 0.45; tilt.add(wheel); wheelPivot.add(tilt);
      const spoke = new THREE.Mesh(M.unitBox, dark); spoke.scale.set(0.02, 0.03, 0.34); wheel.add(spoke); spoke.rotation.y = Math.PI / 2;
      cockpit.add(wheelPivot);
      const rvm = new THREE.Mesh(M.unitBox, dark); rvm.position.set(0.7, 1.45, 0.05); rvm.scale.set(0.04, 0.07, 0.25); cockpit.add(rvm);
      m.group.add(cockpit);
      m.parts.cockpit = cockpit; m.parts.wheel = wheel; m.parts.roofSign = sign;
      void L;
      return m;
    },
  };

  DS.GeoBatch = GeoBatch;
  DS.Models = M;
})();
