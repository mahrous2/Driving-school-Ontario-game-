/* Three.js renderer: driver cockpit view with live mirrors, chase view and top-down tactical view,
 * dynamic vehicles / pedestrians, lights, weather particles and night lighting.
 */
(function () {
  'use strict';
  const DS = window.DS, U = DS.U;

  const VIEWS = ['cockpit', 'chase', 'top'];
  const VIEW_NAMES = { cockpit: 'Driver cockpit', chase: 'Chase camera', top: 'Top-down tactical' };

  const RD = {
    view: 'cockpit',
    zoom: 1,
    init(canvas) {
      this.canvas = canvas;
      this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      this.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      this.r.autoClear = false;
      DS.Models.init();
      this.cam = new THREE.PerspectiveCamera(72, 1, 0.2, 1500);
      this.topCam = new THREE.OrthographicCamera(-50, 50, 50, -50, 1, 600);
      this.mirrorCams = {
        rear: new THREE.PerspectiveCamera(32, 3.2, 0.5, 600),
        left: new THREE.PerspectiveCamera(30, 1.5, 0.3, 500),
        right: new THREE.PerspectiveCamera(30, 1.5, 0.3, 500),
      };
      const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
      this.rts = { rear: new THREE.WebGLRenderTarget(512, 160, rtOpts), left: new THREE.WebGLRenderTarget(256, 170, rtOpts), right: new THREE.WebGLRenderTarget(256, 170, rtOpts) };
      // HUD overlay scene for mirrors
      this.hudScene = new THREE.Scene();
      this.hudCam = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
      this.mirrorQuads = {};
      for (const k of ['rear', 'left', 'right']) {
        const g = new THREE.PlaneGeometry(1, 1);
        const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); // mirror image
        const frame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true }));
        const q = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: this.rts[k].texture, transparent: true }));
        q.position.z = 1; frame.position.z = 0;
        this.hudScene.add(frame); this.hudScene.add(q);
        this.mirrorQuads[k] = { q, frame };
      }
      window.addEventListener('resize', () => this.resize());
      this.resize();
      this.vehModels = new Map();
      DS.Bus.on('vehicleAdded', (v) => this.addVehicle(v));
      DS.Bus.on('vehicleRemoved', (v) => this.removeVehicle(v));
    },

    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      this.w = w; this.h = h;
      this.r.setSize(w, h, false);
      this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
      this.hudCam.right = w; this.hudCam.top = h; this.hudCam.updateProjectionMatrix();
      // mirror strip under the instruction bar: left wing | rear-view | right wing
      const rw = Math.min(400, w * 0.27), rh = rw / 3.2;
      const sw = Math.min(200, w * 0.13), sh = rh;
      const y = h - 74 - rh / 2;
      const L = { rear: { x: w / 2, y, w: rw, h: rh }, left: { x: w / 2 - rw / 2 - 14 - sw / 2, y, w: sw, h: sh }, right: { x: w / 2 + rw / 2 + 14 + sw / 2, y, w: sw, h: sh } };
      for (const k in L) {
        const m = this.mirrorQuads[k], l = L[k];
        m.q.position.set(l.x, l.y, 1); m.q.scale.set(l.w, l.h, 1);
        m.frame.position.set(l.x, l.y, 0); m.frame.scale.set(l.w + 8, l.h + 8, 1);
        this.mirrorCams[k].aspect = l.w / l.h; this.mirrorCams[k].updateProjectionMatrix();
      }
      this.mirrorLayout = L;
    },

    // ---------- world setup ----------
    setup(G) {
      if (this.scene) this.dispose();
      const scene = (this.scene = new THREE.Scene());
      this.G = G;
      const night = G.night, weather = G.weather;
      const sky = night ? 0x0a1222 : weather === 'snow' ? 0xc9d2da : weather === 'rain' ? 0x8f9aa5 : 0x9cc8ea;
      scene.background = new THREE.Color(sky);
      const fogFar = night ? 380 : weather === 'snow' ? 230 : weather === 'rain' ? 320 : 900;
      scene.fog = new THREE.Fog(sky, weather === 'clear' && !night ? 200 : 25, fogFar);
      this.hemi = new THREE.HemisphereLight(night ? 0x334466 : 0xdfefff, night ? 0x111111 : 0x556644, night ? 0.35 : weather === 'clear' ? 0.75 : 0.85);
      scene.add(this.hemi);
      this.sun = new THREE.DirectionalLight(night ? 0x8899cc : 0xfff2dd, night ? 0.15 : weather === 'clear' ? 0.8 : 0.35);
      this.sun.position.set(200, 400, 120);
      scene.add(this.sun);
      this.world = DS.World3D.build(G, scene);
      G.world.obstacles = this.world.obstacles;
      G.world.iceRects = this.world.iceRects;
      if (night) { this.world.windowsMat.emissive = new THREE.Color(0xcccccc); this.world.windowsMat.needsUpdate = true; if (this.world.lampHeads) this.world.lampHeads.material.color.set(0xfff2c0); }
      // player
      this.player = DS.Models.player();
      scene.add(this.player.group);
      this.headlight = new THREE.SpotLight(0xfff4dd, 0, 90, 0.55, 0.45, 1.2);
      this.headlight.position.set(2.2, 0.8, 0);
      this.headlight.target.position.set(25, -1, 0);
      this.player.group.add(this.headlight); this.player.group.add(this.headlight.target);
      // teaching overlays for top-down view
      this.overlay = new THREE.Group();
      const mk = (c, o) => new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false }));
      this.bsL = mk(0x33cc66, 0.25); this.bsR = mk(0x33cc66, 0.25);
      for (const [m, z] of [[this.bsL, -2.8], [this.bsR, 2.8]]) { m.rotation.x = -Math.PI / 2; m.scale.set(8.5, 3.6, 1); m.position.set(-3.25, 0.12, z); this.overlay.add(m); }
      this.stopBar = mk(0xffe066, 0.35); this.stopBar.rotation.x = -Math.PI / 2; this.stopBar.position.y = 0.11; this.overlay.add(this.stopBar);
      this.player.group.add(this.overlay);
      // pedestrians (instanced)
      const cap = 180;
      this.pedMeshes = {
        body: new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.24, 0.75, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), cap),
        head: new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }), cap),
        leg: new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.8, 0.13), new THREE.MeshLambertMaterial({ color: 0x2c3e50 }), cap * 2),
        sign: new THREE.InstancedMesh(new THREE.PlaneGeometry(0.55, 0.55), new THREE.MeshBasicMaterial({ map: DS.Tex.get('stop'), side: THREE.DoubleSide, transparent: true }), 8),
        vest: new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 0.5, 0.5), new THREE.MeshLambertMaterial({ color: 0xff7a00 }), 8),
      };
      const white = new THREE.Color(0xffffff);
      for (const k in this.pedMeshes) {
        const m = this.pedMeshes[k];
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (k === 'body' || k === 'head') for (let i = 0; i < m.instanceMatrix.count; i++) m.setColorAt(i, white); // compile with instance colours
        m.count = 0; m.frustumCulled = false; scene.add(m);
      }
      // weather particles
      this.particles = null;
      if (weather === 'rain' || weather === 'snow') {
        const n = weather === 'rain' ? 5000 : 4500;
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { pos[i * 3] = U.rand(-45, 45); pos[i * 3 + 1] = U.rand(0, 30); pos[i * 3 + 2] = U.rand(-45, 45); }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({ color: weather === 'rain' ? 0xaabbcc : 0xffffff, size: weather === 'rain' ? 0.07 : 0.16, transparent: true, opacity: weather === 'rain' ? 0.6 : 0.9, depthWrite: false });
        this.particles = new THREE.Points(geo, mat); this.particles.frustumCulled = false;
        this.particles.userData = { kind: weather, base: new THREE.Vector3() };
        scene.add(this.particles);
      }
      for (const v of G.traffic.vehicles) this.addVehicle(v);
      this.headYaw = 0;
    },

    dispose() {
      this.scene.traverse((o) => { if (o.geometry && o.geometry !== DS.Models.unitBox) o.geometry.dispose(); if (o.material && o.material.dispose) { if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose()); else o.material.dispose(); } });
      this.vehModels.clear();
      this.scene = null;
    },

    addVehicle(v) {
      if (!this.scene || this.vehModels.has(v.id)) return;
      const m = DS.Models.vehicle(v.type, v.color);
      this.scene.add(m.group);
      this.vehModels.set(v.id, m);
    },
    removeVehicle(v) {
      const m = this.vehModels.get(v.id);
      if (!m) return;
      this.scene.remove(m.group);
      m.group.traverse((o) => { if (o.geometry && o.geometry !== DS.Models.unitBox) o.geometry.dispose(); if (o.material && o.material.map !== DS.Tex.get('stop')) o.material.dispose && o.material.dispose(); });
      this.vehModels.delete(v.id);
    },

    cycleView() {
      this.view = VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length];
      DS.Bus.emit('hint', 'Camera: ' + VIEW_NAMES[this.view]);
    },

    inView(x, y) {
      if (!this.frustum) return false;
      return this.frustum.containsPoint(new THREE.Vector3(x, 1, -y));
    },

    setLamp(mesh, col) { for (const l of mesh || []) l.material.color.setHex(col); },

    // ---------- per-frame ----------
    render(G, dt) {
      if (!this.scene) return;
      const P = G.player, blink = G.blink, fast = Math.floor(G.time * 5) % 2 === 0;
      const night = G.night;
      // player
      const pg = this.player.group;
      pg.position.set(P.x, 0, -P.y); pg.rotation.y = P.h;
      const pl = this.player.lights;
      this.setLamp(pl.brake, P.braking && P.speed > 0.05 || P.brake > 0.1 ? 0xff2020 : P.headlights ? 0x770000 : 0x3a0000);
      this.setLamp(pl.sigL, (P.sigL || P.hazards) && blink ? 0xffa000 : 0x3a2600);
      this.setLamp(pl.sigR, (P.sigR || P.hazards) && blink ? 0xffa000 : 0x3a2600);
      this.setLamp(pl.head, P.headlights ? 0xffffee : 0x9a9a90);
      this.headlight.intensity = P.headlights ? (night ? 2.6 : G.weather !== 'clear' ? 1.2 : 0.4) : 0;
      this.player.parts.wheel.rotation.z = -P.steerIn * 2.2;
      // vehicles
      for (const v of G.traffic.vehicles) {
        const m = this.vehModels.get(v.id);
        if (!m) continue;
        m.group.position.set(v.x, 0, -v.y); m.group.rotation.y = v.h;
        const L = m.lights;
        this.setLamp(L.brake, v.brakeLight ? 0xff2020 : night ? 0x770000 : 0x3a0000);
        this.setLamp(L.sigL, (v.sigL || v.hazards) && blink ? 0xffa000 : 0x3a2600);
        this.setLamp(L.sigR, (v.sigR || v.hazards) && blink ? 0xffa000 : 0x3a2600);
        if (L.head) this.setLamp(L.head, night || G.weather !== 'clear' ? 0xffffee : 0xbdbdb0);
        if (L.beaconA) {
          const on = v.lightsOn;
          this.setLamp(L.beaconA, on && fast ? 0xff1010 : 0x330000);
          this.setLamp(L.beaconB, on && !fast ? (v.type === 'police' ? 0x1040ff : 0xffffff) : 0x111122);
        }
        if (L.busRedA) {
          this.setLamp(L.busRedA, v.redFlash && blink ? 0xff1010 : 0x330000);
          this.setLamp(L.busRedB, v.redFlash && !blink ? 0xff1010 : 0x330000);
          this.setLamp(L.busAmb, v.amberFlash && blink ? 0xffb000 : 0x332200);
        }
        if (m.parts.stopArm) { const tgt = v.stopArm ? 0 : Math.PI / 2; m.parts.stopArm.rotation.y = U.approach(m.parts.stopArm.rotation.y, tgt, dt * 3); }
        if (m.parts.doors) for (const d of m.parts.doors) d.visible = !v.doorsOpen;
      }
      // pedestrians
      this.updatePeds(G);
      // signals
      if (this.world.lampMesh) {
        const lm = this.world.lampMesh, col = new THREE.Color();
        for (const s of this.world.signalLamps) {
          const st = G.net.light(s.node, s.k);
          const on = st === s.c;
          col.setHex(on ? (s.c === 'R' ? 0xff2a1a : s.c === 'Y' ? 0xffb000 : 0x22ff88) : (s.c === 'R' ? 0x2a0806 : s.c === 'Y' ? 0x2a1d00 : 0x062a14));
          lm.setColorAt(s.idx, col);
        }
        for (const b of this.world.beacons) {
          let on = false;
          if (b.kind === 'school') on = G.schoolActive && (blink ? b.phase === 0 : b.phase === 1);
          else if (b.kind === 'pxo') on = (b.f.active || G.peds.crossingOccupied(b.f)) && (blink ? b.phase === 0 : b.phase === 1);
          col.setHex(on ? 0xffb000 : 0x2a1d00);
          lm.setColorAt(b.idx, col);
        }
        if (lm.instanceColor) lm.instanceColor.needsUpdate = true;
      }
      // overlays (top view teaching aids)
      const top = this.view === 'top';
      this.overlay.visible = top;
      if (top) {
        const bl = G.playerLoc.blind || {};
        this.bsL.material.color.setHex(bl.L ? 0xff3030 : 0x33cc66); this.bsL.material.opacity = bl.L ? 0.45 : 0.22;
        this.bsR.material.color.setHex(bl.R ? 0xff3030 : 0x33cc66); this.bsR.material.opacity = bl.R ? 0.45 : 0.22;
        const sd = Math.max(0.5, P.stoppingDistance());
        this.stopBar.scale.set(sd, 0.5, 1); this.stopBar.position.set(2.3 + sd / 2, 0.11, 0);
      }
      // weather
      if (this.particles) this.updateParticles(dt, P);
      this.renderViews(G, dt);
    },

    updatePeds(G) {
      const M = this.pedMeshes, o = new THREE.Object3D(), col = new THREE.Color();
      let n = 0, nl = 0, ns = 0;
      const hip = new THREE.Matrix4(), tmp = new THREE.Matrix4();
      for (const p of G.peds.list) {
        if (n >= M.body.instanceMatrix.count) break;
        const s = p.kid ? 0.68 : 1;
        const bob = p.v > 0 ? Math.abs(Math.sin(p.phase)) * 0.04 : 0;
        o.position.set(p.x, (0.8 + 0.375) * s + bob, -p.y); o.rotation.set(0, p.h, 0); o.scale.set(s, s, s); o.updateMatrix();
        M.body.setMatrixAt(n, o.matrix); M.body.setColorAt(n, col.setHex(p.color));
        o.position.set(p.x, (1.68) * s + bob, -p.y); o.updateMatrix();
        M.head.setMatrixAt(n, o.matrix); M.head.setColorAt(n, col.setHex(p.skin));
        const sw = p.v > 0 ? Math.sin(p.phase) * 0.45 : 0;
        for (const side of [-1, 1]) {
          hip.makeTranslation(p.x, 0.8 * s, -p.y);
          hip.multiply(tmp.makeRotationY(p.h)).multiply(tmp.makeRotationZ(sw * side)).multiply(tmp.makeTranslation(0, -0.4 * s, side * 0.1 * s)).multiply(tmp.makeScale(s, s, s));
          M.leg.setMatrixAt(nl++, hip);
        }
        if (p.isGuard && ns < 8) {
          o.position.set(p.x + Math.cos(p.h) * 0.35, 1.5, -(p.y + Math.sin(p.h) * 0.35)); o.rotation.set(0, p.h + Math.PI / 2, 0); o.scale.set(1, 1, 1); o.updateMatrix();
          M.sign.setMatrixAt(ns, o.matrix);
          o.position.set(p.x, 1.2, -p.y); o.rotation.set(0, p.h, 0); o.updateMatrix(); M.vest.setMatrixAt(ns, o.matrix);
          ns++;
        }
        n++;
      }
      M.body.count = n; M.head.count = n; M.leg.count = nl; M.sign.count = ns; M.vest.count = ns;
      for (const k in M) { M[k].instanceMatrix.needsUpdate = true; if (M[k].instanceColor) M[k].instanceColor.needsUpdate = true; }
    },

    updateParticles(dt, P) {
      const pa = this.particles, pos = pa.geometry.attributes.position.array, rain = pa.userData.kind === 'rain';
      const cx = P.x, cz = -P.y;
      const vy = rain ? 22 : 2.2, n = pos.length / 3;
      const t = this.G.time;
      for (let i = 0; i < n; i++) {
        let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        y -= vy * dt;
        if (!rain) { x += Math.sin(t * 0.8 + i) * 0.5 * dt; z += Math.cos(t * 0.6 + i * 1.3) * 0.5 * dt; }
        if (y < 0) { y += 30; x = cx + U.rand(-45, 45); z = cz + U.rand(-45, 45); }
        if (x - cx > 45) x -= 90; else if (x - cx < -45) x += 90;
        if (z - cz > 45) z -= 90; else if (z - cz < -45) z += 90;
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      }
      pa.geometry.attributes.position.needsUpdate = true;
    },

    localToWorld(P, lx, ly, lz) {
      // car-local (x fwd, y up, z right) -> three world
      const c = Math.cos(P.h), s = Math.sin(P.h);
      const wx = P.x + c * lx + s * lz, wy = P.y + s * lx - c * lz;
      return new THREE.Vector3(wx, ly, -wy);
    },

    renderViews(G, dt) {
      const P = G.player, r = this.r;
      const view = this.view;
      const body = this.player.group.children[0];
      const cockpit = this.player.parts.cockpit;
      // head turn animation for shoulder checks
      let yaw = 0;
      if (G.headAnim) {
        const a = G.headAnim, t = G.time - a.t0;
        const env = t < 0.22 ? t / 0.22 : t < 0.75 ? 1 : t < 1.05 ? 1 - (t - 0.75) / 0.3 : 0;
        if (t > 1.05) G.headAnim = null;
        yaw = (a.dir < 0 ? 1 : -1) * 1.7 * U.smoothstep(0, 1, env);
      }
      this.headYaw = yaw;
      let cam = this.cam;
      if (view === 'cockpit') {
        body.visible = false; cockpit.visible = true; this.player.parts.roofSign.visible = false;
        this.cam.fov = 72; this.cam.updateProjectionMatrix();
        const eye = this.localToWorld(P, -0.05, 1.22, -0.37);
        this.cam.position.copy(eye);
        const look = P.h + yaw;
        const tgt = new THREE.Vector3(eye.x + Math.cos(look) * 10, eye.y - 0.55, eye.z - Math.sin(look) * 10);
        this.cam.up.set(0, 1, 0);
        this.cam.lookAt(tgt);
      } else if (view === 'chase') {
        body.visible = true; cockpit.visible = false; this.player.parts.roofSign.visible = true;
        this.cam.fov = 62; this.cam.updateProjectionMatrix();
        const back = 8.5, up = 3.4;
        const want = new THREE.Vector3(P.x - Math.cos(P.h) * back, up, -(P.y - Math.sin(P.h) * back));
        if (!this._chase) this._chase = want.clone();
        this._chase.lerp(want, Math.min(1, dt * 6));
        this.cam.position.copy(this._chase);
        this.cam.up.set(0, 1, 0);
        this.cam.lookAt(P.x + Math.cos(P.h) * 6, 1.2, -(P.y + Math.sin(P.h) * 6));
      } else {
        body.visible = true; cockpit.visible = false; this.player.parts.roofSign.visible = true;
        cam = this.topCam;
        const half = 34 * this.zoom, aspect = this.w / this.h;
        cam.left = -half * aspect; cam.right = half * aspect; cam.top = half; cam.bottom = -half; cam.updateProjectionMatrix();
        const fx = Math.cos(P.h), fy = Math.sin(P.h);
        const cx = P.x + fx * 12 * this.zoom, cy = P.y + fy * 12 * this.zoom;
        cam.position.set(cx, 300, -cy);
        cam.up.set(fx, 0, -fy);
        cam.lookAt(cx, 0, -cy);
      }
      cam.updateMatrixWorld();
      this.frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      if (this.scene.fog) this.scene.fog.far = view === 'top' ? 5000 : this._fogFar || (this._fogFar = this.scene.fog.far);
      if (view !== 'top' && this._fogFar) this.scene.fog.far = this._fogFar;

      // mirrors (cockpit only)
      const mirrors = view === 'cockpit' && G.settings.mirrors;
      if (mirrors) {
        this._mFrame = (this._mFrame || 0) + 1;
        const P2 = P;
        const setM = (k, lx, ly, lz, yawOff) => {
          const c = this.mirrorCams[k];
          const p = this.localToWorld(P2, lx, ly, lz);
          c.position.copy(p);
          const a = P2.h + Math.PI + yawOff;
          c.up.set(0, 1, 0);
          c.lookAt(p.x + Math.cos(a) * 10, p.y - 0.25, p.z - Math.sin(a) * 10);
        };
        setM('rear', 0.2, 1.35, 0, 0);
        setM('left', 0.75, 1.05, -1.05, -0.2);
        setM('right', 0.75, 1.05, 1.05, 0.2);
        const keys = G.settings.mirrorQuality === 'low' ? [['rear', 'left', 'right'][this._mFrame % 3]] : ['rear', 'left', 'right'];
        const lampMeshes = Object.values(this.player.lights).flat();
        for (const k of keys) {
          body.visible = k !== 'rear'; cockpit.visible = false;
          for (const lm of lampMeshes) lm.visible = k !== 'rear';
          r.setRenderTarget(this.rts[k]); r.clear(); r.render(this.scene, this.mirrorCams[k]);
        }
        r.setRenderTarget(null);
        for (const lm of lampMeshes) lm.visible = true;
        body.visible = false; cockpit.visible = true;
      }
      r.setRenderTarget(null);
      r.clear();
      r.render(this.scene, cam);
      if (mirrors) {
        const fade = 1 - U.clamp(Math.abs(yaw) / 0.6, 0, 1);
        const hl = G.time - P.lastMirror < 1.2;
        for (const k in this.mirrorQuads) {
          const m = this.mirrorQuads[k];
          m.q.material.opacity = fade; m.frame.material.opacity = fade;
          m.frame.material.color.setHex(hl ? 0x29d3ff : 0x111111);
        }
        r.clearDepth();
        r.render(this.hudScene, this.hudCam);
      }
    },
  };
  DS.Renderer = RD;
  DS.VIEW_NAMES = VIEW_NAMES;
})();
