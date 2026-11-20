/* Three.js renderer.
 * - ACES tone-mapped PBR lighting, sky dome + image-based reflections, sun shadow map that follows the car
 * - Detailed vehicles: animated lamps (brake / signals / beacons / bus reds), steered + spinning wheels,
 *   sliding streetcar doors and the school-bus stop arm
 * - One additive "glow" point cloud for every lamp in the scene, headlight pools on the road at night,
 *   soft contact shadows under every vehicle and pedestrian
 * - Spring-damped cameras: driver cockpit (with live mirrors and shoulder-check head turns), chase, top-down
 */
(function () {
  'use strict';
  const DS = window.DS, U = DS.U;

  const VIEWS = ['cockpit', 'chase', 'top'];
  const VIEW_NAMES = { cockpit: 'Driver cockpit', chase: 'Chase camera', top: 'Top-down tactical' };

  // Lamp colours (sRGB hex). "off" values are the unlit lens tints.
  const LC = {
    headOn: 0xfffbf0, headDay: 0xd9dcd6, drl: 0xf2f7ff,
    brakeOn: 0xff1a12, tail: 0x8a0606, off: 0x3a0505,
    sigOn: 0xffa412, sigOff: 0x4a3008, revOn: 0xffffff, revOff: 0x9a9a9a,
    red: 0xff1010, blue: 0x1f5cff, white: 0xffffff, amber: 0xffb000, dimRed: 0x3a0606, dimAmb: 0x3a2a06, dimBlue: 0x0a0a2a,
  };

  // critically damped spring for vectors and angles
  class Spring {
    constructor(k) { this.k = k; this.x = null; this.v = new THREE.Vector3(); }
    update(target, dt) {
      if (!this.x) { this.x = target.clone(); return this.x; }
      const c = 2 * Math.sqrt(this.k), n = Math.max(1, Math.ceil(dt / 0.01)), h = dt / n;
      for (let i = 0; i < n; i++) {
        const ax = (target.x - this.x.x) * this.k - this.v.x * c, ay = (target.y - this.x.y) * this.k - this.v.y * c, az = (target.z - this.x.z) * this.k - this.v.z * c;
        this.v.x += ax * h; this.v.y += ay * h; this.v.z += az * h;
        this.x.x += this.v.x * h; this.x.y += this.v.y * h; this.x.z += this.v.z * h;
      }
      return this.x;
    }
    reset() { this.x = null; this.v.set(0, 0, 0); }
  }
  class AngleSpring {
    constructor(k) { this.k = k; this.a = null; this.v = 0; }
    update(t, dt) {
      if (this.a === null) { this.a = t; return t; }
      const c = 2 * Math.sqrt(this.k);
      this.v += (U.angDiff(t, this.a) * this.k - this.v * c) * dt; this.a = U.angNorm(this.a + this.v * dt);
      return this.a;
    }
  }

  // additive glow sprites for every lamp in the scene (one draw call)
  function makeGlow(max) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(max * 3), col = new Float32Array(max * 3), size = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uFar: { value: 500 }, uOrtho: { value: 0 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; varying float vF; uniform float uScale; uniform float uFar; uniform float uOrtho;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); float d = max(0.5, -mv.z);
          gl_PointSize = clamp(uOrtho > 0.5 ? size * uScale : size * uScale / d, 0.0, 256.0);
          vC = color; vF = 1.0 - smoothstep(uFar * 0.55, uFar, d); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vF;
        void main(){ vec2 c = gl_PointCoord - 0.5; float r2 = dot(c,c) * 4.0; float a = exp(-r2 * 3.5) * 0.75 + exp(-r2 * 28.0) * 0.9; a *= vF; if (a < 0.01) discard; gl_FragColor = vec4(vC * a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 10;
    const g = { pts, mat, n: 0, max, pos, col, size, c: new THREE.Color(),
      reset() { this.n = 0; },
      add(v, hex, s, k) { if (this.n >= max) return; const i = this.n++; pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; this.c.setHex(hex).convertSRGBToLinear(); const kk = k === undefined ? 1 : k; col[i * 3] = this.c.r * kk; col[i * 3 + 1] = this.c.g * kk; col[i * 3 + 2] = this.c.b * kk; size[i] = s; },
      commit() { geo.setDrawRange(0, this.n); for (const a of ['position', 'color', 'size']) geo.attributes[a].needsUpdate = true; },
      // hide the first `skip` sprites (the student car's own lamps) for views from inside the car
      range(skip) { geo.setDrawRange(skip, Math.max(0, this.n - skip)); },
    };
    return g;
  }

  // canvas helpers for mirror bezels
  function roundedTex(w, h, r, frame) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const path = (x, y, ww, hh, rr) => { g.beginPath(); g.moveTo(x + rr, y); g.arcTo(x + ww, y, x + ww, y + hh, rr); g.arcTo(x + ww, y + hh, x, y + hh, rr); g.arcTo(x, y + hh, x, y, rr); g.arcTo(x, y, x + ww, y, rr); g.closePath(); };
    if (frame) {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#3a3f46'); gr.addColorStop(0.5, '#121417'); gr.addColorStop(1, '#2a2e33');
      path(0, 0, w, h, r); g.fillStyle = gr; g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2; path(2, 2, w - 4, h - 4, r - 2); g.stroke();
    } else { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); path(0, 0, w, h, r); g.fillStyle = '#fff'; g.fill(); }
    const t = new THREE.CanvasTexture(c);
    if (frame) t.encoding = THREE.sRGBEncoding;
    return t;
  }

  const RD = {
    view: 'cockpit',
    zoom: 1,
    init(canvas) {
      this.canvas = canvas;
      const r = (this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      r.autoClear = false;
      r.outputEncoding = THREE.sRGBEncoding;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.0;
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      r.shadowMap.autoUpdate = false;
      DS.Models.init();
      this.cam = new THREE.PerspectiveCamera(72, 1, 0.2, 1600);
      this.topCam = new THREE.OrthographicCamera(-50, 50, 50, -50, 1, 900);
      this.mirrorCams = { rear: new THREE.PerspectiveCamera(32, 3.2, 0.5, 600), left: new THREE.PerspectiveCamera(32, 1.6, 0.3, 500), right: new THREE.PerspectiveCamera(32, 1.6, 0.3, 500) };
      const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
      if (r.capabilities.isWebGL2) rtOpts.type = THREE.HalfFloatType; // keep HDR highlights for tone mapping
      this.rts = { rear: new THREE.WebGLRenderTarget(640, 200, rtOpts), left: new THREE.WebGLRenderTarget(320, 200, rtOpts), right: new THREE.WebGLRenderTarget(320, 200, rtOpts) };
      // HUD overlay scene: framed, rounded mirror viewports
      this.hudScene = new THREE.Scene();
      this.hudCam = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
      this.mirrorQuads = {};
      const alpha = roundedTex(256, 96, 22, false), frameTex = roundedTex(256, 104, 26, true);
      for (const k of ['rear', 'left', 'right']) {
        const g = new THREE.PlaneGeometry(1, 1);
        const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); // mirror image
        const frame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: frameTex, transparent: true }));
        const q = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: this.rts[k].texture, alphaMap: alpha, transparent: true }));
        q.position.z = 1;
        this.hudScene.add(frame); this.hudScene.add(q);
        this.mirrorQuads[k] = { q, frame };
      }
      window.addEventListener('resize', () => this.resize());
      this.resize();
      this.vehModels = new Map();
      DS.Bus.on('vehicleAdded', (v) => this.addVehicle(v));
      DS.Bus.on('vehicleRemoved', (v) => this.removeVehicle(v));
      this.springs = { chase: new Spring(26), chaseLook: new Spring(60), top: new Spring(18), topRot: new AngleSpring(9), chaseYaw: new AngleSpring(14), lean: new Spring(30) };
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
      const y = h - 76 - rh / 2;
      const L = { rear: { x: w / 2, y, w: rw, h: rh }, left: { x: w / 2 - rw / 2 - 16 - sw / 2, y: y - 6, w: sw, h: sh }, right: { x: w / 2 + rw / 2 + 16 + sw / 2, y: y - 6, w: sw, h: sh } };
      for (const k in L) {
        const m = this.mirrorQuads[k], l = L[k];
        m.q.position.set(l.x, l.y, 1); m.q.scale.set(l.w, l.h, 1);
        m.frame.position.set(l.x, l.y, 0); m.frame.scale.set(l.w + 12, l.h + 12, 1);
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
      const P = night ? { top: 0x03070f, hor: 0x18213a, gnd: 0x07090c, sun: 0x8899cc, sunI: 0.12, hemiS: 0x334466, hemiG: 0x0d0f12, hemiI: 0.45, fog: 0x121a2c, near: 30, far: 420, exp: 1.25 }
        : weather === 'snow' ? { top: 0x8d9aa7, hor: 0xd8dfe5, gnd: 0xdfe5ea, sun: 0xfff4e6, sunI: 1.0, hemiS: 0xdfe8f2, hemiG: 0x9aa3ab, hemiI: 1.15, fog: 0xd2d9df, near: 20, far: 240, exp: 0.95 }
          : weather === 'rain' ? { top: 0x5b6773, hor: 0x9aa6b0, gnd: 0x4a5058, sun: 0xdde6ee, sunI: 0.75, hemiS: 0xb5c2cd, hemiG: 0x3c4249, hemiI: 1.1, fog: 0x8f9aa4, near: 25, far: 340, exp: 1.05 }
            : { top: 0x2f6fc4, hor: 0xc4ddf0, gnd: 0x5d6b4c, sun: 0xfff1dc, sunI: 2.3, hemiS: 0xcfe3ff, hemiG: 0x6e6a58, hemiI: 1.35, fog: 0xc9dbe8, near: 220, far: 1100, exp: 1.0 };
      this.pal = P;
      this.r.toneMappingExposure = P.exp;
      scene.background = DS.lin(P.hor);
      scene.fog = new THREE.Fog(DS.lin(P.fog), P.near, P.far);
      this._fogFar = P.far;
      // sky dome (also used to bake the reflection environment)
      const sunDir = new THREE.Vector3(0.45, 0.62, 0.3).normalize();
      this.sunDir = sunDir;
      const skyMat = new THREE.ShaderMaterial({
        uniforms: { top: { value: DS.lin(P.top) }, hor: { value: DS.lin(P.hor) }, gnd: { value: DS.lin(P.gnd) }, sunDir: { value: sunDir }, sunCol: { value: DS.lin(P.sun).multiplyScalar(night ? 0.4 : weather === 'clear' ? 3 : 0.6) } },
        vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 gnd; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vD;
          void main(){ float y = vD.y; vec3 c = y > 0.0 ? mix(hor, top, pow(clamp(y,0.0,1.0), 0.55)) : mix(hor, gnd, clamp(-y*6.0,0.0,1.0));
            float s = max(dot(normalize(vD), sunDir), 0.0); c += sunCol * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.12);
            gl_FragColor = vec4(c, 1.0); }`,
        side: THREE.BackSide, depthWrite: false, fog: false,
      });
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(1300, 32, 16), skyMat);
      this.sky.renderOrder = -1;
      scene.add(this.sky);
      // reflection environment: a small cube map painted with the same sky gradient
      this.envRT = { texture: this.skyCube(P), dispose() { this.texture.dispose(); } };
      scene.environment = this.envRT.texture;
      // lights
      this.hemi = new THREE.HemisphereLight(DS.lin(P.hemiS), DS.lin(P.hemiG), P.hemiI);
      scene.add(this.hemi);
      const sun = (this.sun = new THREE.DirectionalLight(DS.lin(P.sun), P.sunI));
      sun.castShadow = !night;
      sun.shadow.mapSize.set(2048, 2048);
      const sc = sun.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 500;
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
      scene.add(sun); scene.add(sun.target);
      // world
      this.world = DS.World3D.build(G, scene);
      G.world.obstacles = this.world.obstacles;
      G.world.iceRects = this.world.iceRects;
      if (night) { this.world.windowsMat.emissive = new THREE.Color(0xffffff); this.world.windowsMat.emissiveIntensity = 0.9; this.world.windowsMat.needsUpdate = true; if (this.world.lampHeads) this.world.lampHeads.material.color = DS.lin(0xfff3c4); }
      if (this.world.lampMesh) {
        const mtx = new THREE.Matrix4();
        for (const b of this.world.beacons) { this.world.lampMesh.getMatrixAt(b.idx, mtx); b.pos = new THREE.Vector3().setFromMatrixPosition(mtx); }
      }
      // student car + headlights
      this.player = DS.Models.player();
      scene.add(this.player.group);
      this.headlights = [];
      for (const z of [-0.62, 0.62]) {
        const l = new THREE.SpotLight(0xfff1dd, 0, 95, 0.42, 0.55, 1.3);
        l.position.set(2.3, 0.75, z); l.target.position.set(30, -0.8, z * 1.5);
        this.player.group.add(l); this.player.group.add(l.target);
        this.headlights.push(l);
      }
      // teaching overlays for the top-down view
      this.overlay = new THREE.Group();
      const mk = (c, o) => new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, toneMapped: false }));
      this.bsL = mk(0x33cc66, 0.25); this.bsR = mk(0x33cc66, 0.25);
      for (const [m, z] of [[this.bsL, -2.8], [this.bsR, 2.8]]) { m.rotation.x = -Math.PI / 2; m.scale.set(8.5, 3.6, 1); m.position.set(-3.25, 0.12, z); this.overlay.add(m); }
      this.stopBar = mk(0xffe066, 0.35); this.stopBar.rotation.x = -Math.PI / 2; this.stopBar.position.y = 0.11; this.overlay.add(this.stopBar);
      this.player.group.add(this.overlay);
      // contact shadows & headlight pools (instanced)
      const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      this.blobs = new THREE.InstancedMesh(blobGeo, new THREE.MeshBasicMaterial({ map: DS.Tex.get('blob'), transparent: true, depthWrite: false, opacity: night ? 0.75 : 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), 400);
      this.pools = new THREE.InstancedMesh(blobGeo, new THREE.MeshBasicMaterial({ map: DS.Tex.get('beam'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: night ? 0.55 : 0.22, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }), 160);
      for (const m of [this.blobs, this.pools]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false; scene.add(m); }
      // glow sprites
      this.glow = makeGlow(5000);
      scene.add(this.glow.pts);
      // pedestrians (instanced): torso, head, hair, legs, arms
      const cap = 180, white = new THREE.Color(1, 1, 1);
      const pm2 = (geo, color, n) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: color || 0xffffff, roughness: 0.85 }), n || cap); m.castShadow = true; return m; };
      this.pedMeshes = {
        body: pm2(new THREE.CylinderGeometry(0.19, 0.16, 0.62, 10)),
        head: pm2(new THREE.SphereGeometry(0.12, 12, 10)),
        hair: pm2(new THREE.SphereGeometry(0.125, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)),
        leg: pm2(new THREE.BoxGeometry(0.13, 0.82, 0.14), null, cap * 2),
        arm: pm2(new THREE.BoxGeometry(0.09, 0.6, 0.1), null, cap * 2),
        sign: new THREE.InstancedMesh(new THREE.CircleGeometry(0.3, 8), new THREE.MeshBasicMaterial({ map: DS.Tex.get('stopRound'), side: THREE.DoubleSide, toneMapped: false }), 8),
        vest: pm2(new THREE.CylinderGeometry(0.215, 0.185, 0.5, 10), 0xff7a00, 8),
      };
      for (const k in this.pedMeshes) {
        const m = this.pedMeshes[k];
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (k !== 'sign' && k !== 'vest') for (let i = 0; i < m.instanceMatrix.count; i++) m.setColorAt(i, white); // compile with instance colours
        m.count = 0; m.frustumCulled = false; scene.add(m);
      }
      // weather particles
      this.particles = null;
      if (weather === 'rain' || weather === 'snow') {
        const n = weather === 'rain' ? 6000 : 5000;
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { pos[i * 3] = U.rand(-45, 45); pos[i * 3 + 1] = U.rand(0, 30); pos[i * 3 + 2] = U.rand(-45, 45); }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({ color: weather === 'rain' ? 0x9fb0c2 : 0xffffff, size: weather === 'rain' ? 0.06 : 0.15, transparent: true, opacity: weather === 'rain' ? 0.55 : 0.9, depthWrite: false });
        this.particles = new THREE.Points(geo, mat); this.particles.frustumCulled = false;
        this.particles.userData = { kind: weather };
        scene.add(this.particles);
      }
      for (const v of G.traffic.vehicles) this.addVehicle(v);
      for (const s of Object.values(this.springs)) s.reset ? s.reset() : (s.a = null);
      this.headYaw = 0;
      this._tmp = new THREE.Vector3();
    },

    skyCube(P) {
      const css = (hex) => '#' + new THREE.Color(hex).getHexString();
      const face = (kind) => {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const g = c.getContext('2d');
        if (kind === 'top') { g.fillStyle = css(P.top); g.fillRect(0, 0, 64, 64); }
        else if (kind === 'bottom') { g.fillStyle = css(P.gnd); g.fillRect(0, 0, 64, 64); }
        else {
          const gr = g.createLinearGradient(0, 0, 0, 64);
          gr.addColorStop(0, css(P.top)); gr.addColorStop(0.48, css(P.hor)); gr.addColorStop(0.52, css(P.gnd)); gr.addColorStop(1, css(P.gnd));
          g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
        }
        return c;
      };
      // order: +x, -x, +y, -y, +z, -z
      const t = new THREE.CubeTexture([face('side'), face('side'), face('top'), face('bottom'), face('side'), face('side')]);
      t.encoding = THREE.sRGBEncoding;
      t.needsUpdate = true;
      return t;
    },

    dispose() {
      this.scene.traverse((o) => {
        if (o.geometry && o.geometry !== DS.Models.unitBox && !o.userData.shared) o.geometry.dispose();
      });
      if (this.envRT) this.envRT.dispose();
      this.vehModels.clear();
      this.scene = null;
    },

    addVehicle(v) {
      if (!this.scene || this.vehModels.has(v.id)) return;
      const m = DS.Models.vehicle(v.type, v.color);
      m.prevH = v.h; m.steer = 0;
      this.scene.add(m.group);
      this.vehModels.set(v.id, m);
    },
    removeVehicle(v) {
      const m = this.vehModels.get(v.id);
      if (!m) return;
      this.scene.remove(m.group);
      if (m.lamps.mesh) m.lamps.mesh.geometry.dispose(); // per-vehicle; other geometry is cached & shared
      this.vehModels.delete(v.id);
    },

    cycleView() {
      this.view = VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length];
      DS.Bus.emit('hint', 'Camera: ' + VIEW_NAMES[this.view]);
    },
    inView(x, y) { return this.frustum ? this.frustum.containsPoint(new THREE.Vector3(x, 1, -y)) : false; },

    // ---------- per-frame ----------
    // apply lamp + glow state to a vehicle model
    lights(m, st, glowK) {
      const L = m.lamps, blinkL = st.sigL && st.blink, blinkR = st.sigR && st.blink;
      L.set('head', st.head ? LC.headOn : LC.headDay);
      L.set('drl', LC.drl);
      L.set('brake', st.brake ? LC.brakeOn : st.head ? LC.tail : LC.off);
      L.set('sigL', blinkL ? LC.sigOn : LC.sigOff); L.set('sigR', blinkR ? LC.sigOn : LC.sigOff);
      L.set('reverse', st.reverse ? LC.revOn : LC.revOff);
      L.set('beaconA', st.beacon && st.fast ? LC.red : LC.dimRed);
      L.set('beaconB', st.beacon && !st.fast ? (m.type === 'police' ? LC.blue : LC.white) : LC.dimBlue);
      L.set('busRedA', st.busRed && st.blink ? LC.red : LC.dimRed); L.set('busRedB', st.busRed && !st.blink ? LC.red : LC.dimRed);
      L.set('busAmb', st.busAmb && st.blink ? LC.amber : LC.dimAmb);
      L.set('armLamp', st.busRed && st.blink ? LC.red : LC.dimRed);
      L.set('doorLamp', st.doors ? LC.amber : LC.dimAmb);
      L.set('marker', st.head ? LC.amber : LC.dimAmb);
      const gl = this.glow, w = this._tmp, mw = m.group.matrixWorld;
      for (const a of m.glows) {
        let hex = 0, k = 1, s = a.size;
        switch (a.name) {
          case 'head': if (st.head) { hex = 0xfff3dd; k = glowK; s *= 1.6; } else { hex = 0xe8eef8; k = 0.12; } break;
          case 'brake': if (st.brake) { hex = 0xff2a18; k = 1.1; s *= 1.25; } else if (st.head) { hex = 0xff1a10; k = 0.45; } break;
          case 'sigL': if (blinkL) { hex = 0xffa412; k = 1.1; } break;
          case 'sigR': if (blinkR) { hex = 0xffa412; k = 1.1; } break;
          case 'beaconA': if (st.beacon && st.fast) { hex = 0xff1010; k = 1.6; } break;
          case 'beaconB': if (st.beacon && !st.fast) { hex = m.type === 'police' ? 0x2050ff : 0xffffff; k = 1.6; } break;
          case 'busRedA': if (st.busRed && st.blink) { hex = 0xff1010; k = 1.6; } break;
          case 'busRedB': if (st.busRed && !st.blink) { hex = 0xff1010; k = 1.6; } break;
          case 'busAmb': if (st.busAmb && st.blink) { hex = 0xffb000; k = 1.3; } break;
          case 'doorLamp': if (st.doors) { hex = 0xffb000; k = 0.8; } break;
          default: break;
        }
        if (!hex) continue;
        w.copy(a.p).applyMatrix4(mw);
        gl.add(w, hex, s, k);
      }
    },
    wheels(m, v, steer, dt) {
      if (!m.wheels) return;
      for (const wh of m.wheels) {
        if (wh.front) wh.pivot.rotation.y = steer;
        wh.spin.rotation.z -= (v * dt) / wh.r;
      }
    },

    render(G, dt) {
      if (!this.scene) return;
      dt = Math.min(dt, 0.05);
      const P = G.player, blink = G.blink, fast = Math.floor(G.time * 5) % 2 === 0;
      const night = G.night, lowVis = night || G.weather !== 'clear';
      const glowK = night ? 1.0 : lowVis ? 0.55 : 0.25;
      this.glow.reset();
      const blobs = this.blobs, pools = this.pools, o = new THREE.Object3D();
      let nb = 0, np = 0;
      const addBlob = (x, y, h, l, w) => { if (nb >= 400) return; o.position.set(x, 0.035, -y); o.rotation.set(0, h, 0); o.scale.set(l, 1, w); o.updateMatrix(); blobs.setMatrixAt(nb++, o.matrix); };
      const addPool = (x, y, h) => {
        if (np >= 160) return;
        const fx = Math.cos(h), fy = Math.sin(h);
        o.position.set(x + fx * 11, 0.045, -(y + fy * 11)); o.rotation.set(0, h - Math.PI / 2, 0); o.scale.set(5.2, 1, 19); o.updateMatrix(); pools.setMatrixAt(np++, o.matrix);
      };
      // ---- student car ----
      const pg = this.player.group;
      pg.position.set(P.x, 0, -P.y); pg.rotation.y = P.h;
      pg.updateMatrixWorld();
      this.lights(this.player, { head: P.headlights, brake: (P.brake > 0.08 && P.speed > 0.05) || (P.speed < 0.05 && P.brake > 0.05), sigL: P.sigL || P.hazards, sigR: P.sigR || P.hazards, blink, reverse: P.gear === 'R' }, glowK);
      for (const l of this.headlights) l.intensity = P.headlights ? (night ? 3.2 : lowVis ? 1.4 : 0.4) : 0;
      this.glow.playerN = this.glow.n;
      this.wheels(this.player, P.v, P.steer, dt);
      this.player.parts.wheel.rotation.z = -P.steerIn * 2.4;
      addBlob(P.x, P.y, P.h, 5.3, 2.4);
      // ---- AI vehicles ----
      for (const v of G.traffic.vehicles) {
        const m = this.vehModels.get(v.id);
        if (!m) continue;
        m.group.position.set(v.x, 0, -v.y); m.group.rotation.y = v.h;
        m.group.updateMatrixWorld();
        const yaw = U.angDiff(v.h, m.prevH) / Math.max(dt, 1e-3); m.prevH = v.h;
        const target = v.v > 0.5 ? U.clamp(Math.atan((v.len * 0.6 * yaw) / v.v), -0.6, 0.6) : m.steer;
        m.steer += (target - m.steer) * Math.min(1, dt * 8);
        const d = Math.abs(v.x - P.x) + Math.abs(v.y - P.y);
        if (m.wheels) for (const wh of m.wheels) wh.pivot.visible = d < 160;
        this.wheels(m, v.v, m.steer, dt);
        const head = lowVis || v.type === 'streetcar' || v.emergency;
        this.lights(m, { head, brake: v.brakeLight, sigL: v.sigL || v.hazards, sigR: v.sigR || v.hazards, blink, beacon: v.lightsOn, fast, busRed: v.redFlash, busAmb: v.amberFlash, doors: v.doorsOpen }, glowK);
        if (m.parts.stopArm) { const tgt = v.stopArm ? 0 : Math.PI / 2; m.parts.stopArm.rotation.y = U.approach(m.parts.stopArm.rotation.y, tgt, dt * 2.5); }
        if (m.parts.doors) for (const dd of m.parts.doors) { const tx = dd.userData.closedX + (v.doorsOpen ? dd.userData.dir * 0.85 : 0); dd.position.x = U.approach(dd.position.x, tx, dt * 1.6); dd.position.z = U.approach(dd.position.z, DS.VTYPES.streetcar.wid / 2 + (v.doorsOpen ? 0.12 : 0.06), dt * 0.5); }
        addBlob(v.x, v.y, v.h, v.len * 1.12, v.wid * 1.35);
        if (lowVis && head && v.kind === 'veh' && d < 260) addPool(v.x + Math.cos(v.h) * v.len / 2, v.y + Math.sin(v.h) * v.len / 2, v.h);
      }
      // ---- pedestrians ----
      this.updatePeds(G, addBlob);
      // ---- traffic signals & beacons ----
      if (this.world.lampMesh) {
        const lm = this.world.lampMesh, col = new THREE.Color();
        for (const s of this.world.signalLamps) {
          const on = G.net.light(s.node, s.k) === s.c;
          const hex = s.c === 'R' ? 0xff2a1a : s.c === 'Y' ? 0xffb000 : 0x1dff8a;
          col.setHex(on ? hex : s.c === 'R' ? 0x2a0806 : s.c === 'Y' ? 0x2a1d00 : 0x062a14).convertSRGBToLinear();
          if (on) { col.multiplyScalar(2.5); if (Math.abs(s.pos.x - P.x) + Math.abs(-s.pos.z - P.y) < 400) this.glow.add(s.pos, hex, 1.5, night ? 1.1 : 0.7); }
          lm.setColorAt(s.idx, col);
        }
        for (const b of this.world.beacons) {
          let on = false;
          if (b.kind === 'school') on = G.schoolActive && (blink ? b.phase === 0 : b.phase === 1);
          else if (b.kind === 'pxo') on = (b.f.active || G.peds.crossingOccupied(b.f)) && (blink ? b.phase === 0 : b.phase === 1);
          col.setHex(on ? 0xffb000 : 0x2a1d00).convertSRGBToLinear();
          if (on) { col.multiplyScalar(2.5); this.glow.add(b.pos, 0xffb000, 1.6, 1.0); }
          lm.setColorAt(b.idx, col);
        }
        if (lm.instanceColor) lm.instanceColor.needsUpdate = true;
        lm.material.toneMapped = false;
      }
      if (night) for (const p of this.world.lampPts) if (Math.abs(p.x - P.x) + Math.abs(-p.z - P.y) < 350) this.glow.add(p, 0xffd9a0, 2.6, 0.75);
      this.glow.commit();
      blobs.count = nb; blobs.instanceMatrix.needsUpdate = true;
      pools.count = np; pools.instanceMatrix.needsUpdate = true;
      // ---- overlays (top view teaching aids) ----
      const top = this.view === 'top';
      this.overlay.visible = top;
      if (top) {
        const bl = G.playerLoc.blind || {};
        this.bsL.material.color.setHex(bl.L ? 0xff3030 : 0x33cc66); this.bsL.material.opacity = bl.L ? 0.45 : 0.22;
        this.bsR.material.color.setHex(bl.R ? 0xff3030 : 0x33cc66); this.bsR.material.opacity = bl.R ? 0.45 : 0.22;
        const sd = Math.max(0.5, P.stoppingDistance());
        this.stopBar.scale.set(sd, 0.5, 1); this.stopBar.position.set(2.3 + sd / 2, 0.11, 0);
      }
      if (this.particles) this.updateParticles(dt, P);
      this.renderViews(G, dt);
    },

    updatePeds(G, addBlob) {
      const M = this.pedMeshes, col = new THREE.Color();
      let n = 0, nl = 0, na = 0, ns = 0;
      const mtx = new THREE.Matrix4(), t = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3();
      const set = (mesh, i, x, y, z, ry, sx, sy, sz) => { e.set(0, ry, 0); q.setFromEuler(e); mtx.compose(new THREE.Vector3(x, y, z), q, one.set(sx, sy, sz)); mesh.setMatrixAt(i, mtx); };
      for (const p of G.peds.list) {
        if (n >= M.body.instanceMatrix.count) break;
        const s = p.kid ? 0.68 : 1;
        const walk = p.v > 0 ? Math.sin(p.phase) : 0;
        const bob = p.v > 0 ? Math.abs(walk) * 0.035 : 0;
        const x = p.x, z = -p.y;
        set(M.body, n, x, (0.82 + 0.31) * s + bob, z, p.h, s, s, s); M.body.setColorAt(n, col.setHex(p.color).convertSRGBToLinear());
        set(M.head, n, x, 1.6 * s + bob, z, p.h, s, s, s); M.head.setColorAt(n, col.setHex(p.skin).convertSRGBToLinear());
        set(M.hair, n, x, 1.62 * s + bob, z, p.h, s, s, s); M.hair.setColorAt(n, col.setHex(p.hairCol || (p.hairCol = [0x2a1b10, 0x0f0f0f, 0x6b4a2a, 0xb08850, 0x555555][Math.floor(Math.random() * 5)])).convertSRGBToLinear());
        const pants = p.pantsCol || (p.pantsCol = [0x22303f, 0x1b1b1b, 0x3a3f4a, 0x50402e, 0x2c3e50][Math.floor(Math.random() * 5)]);
        for (const side of [-1, 1]) {
          mtx.makeTranslation(x, 0.82 * s, z).multiply(t.makeRotationY(p.h)).multiply(t.makeRotationZ(walk * 0.45 * side)).multiply(t.makeTranslation(0, -0.41 * s, side * 0.1 * s)).multiply(t.makeScale(s, s, s));
          M.leg.setMatrixAt(nl, mtx); M.leg.setColorAt(nl++, col.setHex(pants).convertSRGBToLinear());
          mtx.makeTranslation(x, 1.36 * s + bob, z).multiply(t.makeRotationY(p.h)).multiply(t.makeRotationZ(-walk * 0.5 * side)).multiply(t.makeTranslation(0, -0.28 * s, side * 0.24 * s)).multiply(t.makeScale(s, s, s));
          M.arm.setMatrixAt(na, mtx); M.arm.setColorAt(na++, col.setHex(p.color).convertSRGBToLinear());
        }
        if (p.isGuard && ns < 8) {
          set(M.sign, ns, x + Math.cos(p.h) * 0.4, 1.55, -(p.y + Math.sin(p.h) * 0.4), p.h + Math.PI / 2, 1, 1, 1);
          set(M.vest, ns, x, 1.18, z, p.h, 1, 1, 1);
          ns++;
        }
        addBlob(p.x, p.y, 0, 0.9 * s, 0.9 * s);
        n++;
      }
      M.body.count = M.head.count = M.hair.count = n; M.leg.count = nl; M.arm.count = na; M.sign.count = M.vest.count = ns;
      for (const k in M) { M[k].instanceMatrix.needsUpdate = true; if (M[k].instanceColor) M[k].instanceColor.needsUpdate = true; }
    },

    updateParticles(dt, P) {
      const pa = this.particles, pos = pa.geometry.attributes.position.array, rain = pa.userData.kind === 'rain';
      const cx = P.x, cz = -P.y, vy = rain ? 22 : 2.2, n = pos.length / 3, t = this.G.time;
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
      const c = Math.cos(P.h), s = Math.sin(P.h);
      return new THREE.Vector3(P.x + c * lx + s * lz, ly, -(P.y + s * lx - c * lz));
    },
    setExterior(on) { for (const o of this.player.exterior) o.visible = on; },
    glowScale(cam, h) {
      const u = this.glow.mat.uniforms;
      if (cam.isOrthographicCamera) { u.uOrtho.value = 1; u.uScale.value = h / (cam.top - cam.bottom); u.uFar.value = 9999; }
      else { u.uOrtho.value = 0; u.uScale.value = (h / 2) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)); u.uFar.value = this._fogFar || 800; }
    },

    renderViews(G, dt) {
      const P = G.player, r = this.r, view = this.view, S = this.springs;
      const cockpit = this.player.parts.cockpit;
      // head turn for shoulder checks
      let yaw = 0;
      if (G.headAnim) {
        const a = G.headAnim, t = G.time - a.t0;
        const env = t < 0.22 ? t / 0.22 : t < 0.75 ? 1 : t < 1.05 ? 1 - (t - 0.75) / 0.3 : 0;
        if (t > 1.05) G.headAnim = null;
        yaw = (a.dir < 0 ? 1 : -1) * 1.7 * U.smoothstep(0, 1, env);
      }
      this.headYaw = yaw;
      let cam = this.cam;
      const pr = Math.min(window.devicePixelRatio || 1, 1.75);
      if (view === 'cockpit') {
        this.setExterior(false); cockpit.visible = true;
        this.cam.fov = 72; this.cam.updateProjectionMatrix();
        // the head leans with acceleration (spring) for a sense of weight
        const lat = P.speed * (P.steer || 0) * P.speed / P.L;
        const lean = S.lean.update(new THREE.Vector3(U.clamp(-P.aLong * 0.012, -0.06, 0.06), U.clamp(lat * 0.004, -0.04, 0.04), 0), dt);
        const eye = this.localToWorld(P, -0.05 + lean.x, 1.24, -0.37);
        this.cam.position.copy(eye);
        const look = P.h + yaw;
        this.cam.up.set(Math.sin(P.h) * lean.y, 1, Math.cos(P.h) * lean.y).normalize();
        this.cam.lookAt(eye.x + Math.cos(look) * 10, eye.y - 0.5 - lean.x * 4, eye.z - Math.sin(look) * 10);
      } else if (view === 'chase') {
        this.setExterior(true); cockpit.visible = false;
        this.cam.fov = 60 + Math.min(10, P.speed * 0.25); this.cam.updateProjectionMatrix();
        const hY = S.chaseYaw.update(P.h, dt);
        const back = 7.6, up = 2.9;
        const want = new THREE.Vector3(P.x - Math.cos(hY) * back, up, -(P.y - Math.sin(hY) * back));
        this.cam.position.copy(S.chase.update(want, dt));
        const lookW = S.chaseLook.update(new THREE.Vector3(P.x + Math.cos(P.h) * 6, 1.1, -(P.y + Math.sin(P.h) * 6)), dt);
        this.cam.up.set(0, 1, 0);
        this.cam.lookAt(lookW);
      } else {
        this.setExterior(true); cockpit.visible = false;
        cam = this.topCam;
        const half = 34 * this.zoom, aspect = this.w / this.h;
        cam.left = -half * aspect; cam.right = half * aspect; cam.top = half; cam.bottom = -half; cam.updateProjectionMatrix();
        const hT = S.topRot.update(P.h, dt);
        const fx = Math.cos(hT), fy = Math.sin(hT);
        const c = S.top.update(new THREE.Vector3(P.x + fx * 7 * this.zoom, 0, -(P.y + fy * 7 * this.zoom)), dt);
        cam.position.set(c.x, 300, c.z);
        cam.up.set(fx, 0, -fy);
        cam.lookAt(c.x, 0, c.z);
      }
      cam.updateMatrixWorld();
      this.frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      this.scene.fog.far = view === 'top' ? 5000 : this._fogFar;
      this.sky.position.set(P.x, 0, -P.y);
      // sun + shadow camera follow the car
      const focus = this._tmp.set(P.x + Math.cos(P.h) * 18, 0, -(P.y + Math.sin(P.h) * 18));
      this.sun.position.copy(focus).addScaledVector(this.sunDir, 200);
      this.sun.target.position.copy(focus); this.sun.target.updateMatrixWorld();
      r.shadowMap.needsUpdate = true;

      // mirrors (cockpit & chase)
      const mirrors = (view === 'cockpit' || view === 'chase') && G.settings.mirrors;
      if (mirrors) {
        this._mFrame = (this._mFrame || 0) + 1;
        const setM = (k, lx, ly, lz, yawOff) => {
          const c = this.mirrorCams[k];
          const p = this.localToWorld(P, lx, ly, lz);
          c.position.copy(p);
          const a = P.h + Math.PI + yawOff;
          c.up.set(0, 1, 0);
          c.lookAt(p.x + Math.cos(a) * 10, p.y - 0.3, p.z - Math.sin(a) * 10);
        };
        setM('rear', 0.2, 1.35, 0, 0);
        setM('left', 0.75, 1.05, -1.05, -0.2);
        setM('right', 0.75, 1.05, 1.05, 0.2);
        const keys = G.settings.mirrorQuality === 'low' ? [['rear', 'left', 'right'][this._mFrame % 3]] : ['rear', 'left', 'right'];
        const prevC = cockpit.visible;
        cockpit.visible = false;
        this.glow.pts.visible = true;
        for (const k of keys) {
          this.setExterior(k !== 'rear');
          this.glow.range(k === 'rear' ? this.glow.playerN : 0);
          this.glowScale(this.mirrorCams[k], this.rts[k].height);
          r.setRenderTarget(this.rts[k]); r.clear(); r.render(this.scene, this.mirrorCams[k]);
        }
        r.setRenderTarget(null);
        cockpit.visible = prevC;
        this.setExterior(view !== 'cockpit');
      }
      r.setRenderTarget(null);
      r.clear();
      this.glowScale(cam, this.h * pr);
      this.glow.range(view === 'cockpit' ? this.glow.playerN : 0);
      r.render(this.scene, cam);
      if (mirrors) {
        const fade = 1 - U.clamp(Math.abs(yaw) / 0.6, 0, 1);
        const hl = G.time - P.lastMirror < 1.2;
        for (const k in this.mirrorQuads) {
          const m = this.mirrorQuads[k];
          m.q.material.opacity = fade; m.frame.material.opacity = fade;
          m.frame.material.color.setHex(hl ? 0x7fe8ff : 0xffffff);
        }
        r.clearDepth();
        r.render(this.hudScene, this.hudCam);
      }
    },
  };
  DS.Renderer = RD;
  DS.VIEW_NAMES = VIEW_NAMES;
})();
