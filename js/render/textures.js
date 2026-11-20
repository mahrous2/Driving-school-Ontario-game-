/* Procedural canvas textures: Ontario-style road signs, building windows, ground glow. */
(function () {
  'use strict';
  const DS = window.DS;
  const cache = new Map();

  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tex(c) { const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t; }
  function octagon(g, cx, cy, r) {
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    g.closePath();
  }
  function text(g, s, x, y, size, color, weight) {
    g.fillStyle = color; g.font = (weight || 'bold') + ' ' + size + 'px "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y);
  }

  const makers = {
    stop() {
      const c = canvas(256, 256), g = c.getContext('2d');
      octagon(g, 128, 128, 126); g.fillStyle = '#fff'; g.fill();
      octagon(g, 128, 128, 116); g.fillStyle = '#c8102e'; g.fill();
      text(g, 'STOP', 128, 132, 84, '#fff');
      return c;
    },
    allway() {
      const c = canvas(256, 80), g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 80); g.strokeStyle = '#c8102e'; g.lineWidth = 8; g.strokeRect(4, 4, 248, 72);
      text(g, 'ALL WAY', 128, 42, 50, '#c8102e');
      return c;
    },
    yield() {
      const c = canvas(256, 256), g = c.getContext('2d');
      g.beginPath(); g.moveTo(8, 20); g.lineTo(248, 20); g.lineTo(128, 236); g.closePath(); g.fillStyle = '#c8102e'; g.fill();
      g.beginPath(); g.moveTo(50, 44); g.lineTo(206, 44); g.lineTo(128, 184); g.closePath(); g.fillStyle = '#fff'; g.fill();
      return c;
    },
    speed(n) {
      const c = canvas(192, 256), g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 192, 256); g.strokeStyle = '#111'; g.lineWidth = 8; g.strokeRect(8, 8, 176, 240);
      text(g, 'MAXIMUM', 96, 46, 30, '#111');
      text(g, String(n), 96, 136, 104, '#111');
      text(g, 'km/h', 96, 212, 32, '#111');
      return c;
    },
    school() {
      const c = canvas(256, 320), g = c.getContext('2d');
      g.fillStyle = '#d7e600'; g.beginPath(); g.moveTo(128, 8); g.lineTo(248, 90); g.lineTo(248, 312); g.lineTo(8, 312); g.lineTo(8, 90); g.closePath(); g.fill();
      g.strokeStyle = '#111'; g.lineWidth = 6; g.stroke();
      text(g, 'SCHOOL', 128, 120, 44, '#111'); text(g, 'ZONE', 128, 168, 44, '#111');
      g.fillStyle = '#fff'; g.fillRect(40, 196, 176, 104); g.strokeRect(40, 196, 176, 104);
      text(g, '40', 128, 236, 56, '#111'); text(g, 'WHEN FLASHING', 128, 284, 20, '#111');
      return c;
    },
    nrtor() {
      const c = canvas(192, 256), g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 192, 256); g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(6, 6, 180, 244);
      // right-turn arrow with red prohibition circle
      g.strokeStyle = '#111'; g.lineWidth = 14; g.beginPath(); g.moveTo(80, 170); g.lineTo(80, 100); g.quadraticCurveTo(80, 76, 104, 76); g.lineTo(124, 76); g.stroke();
      g.fillStyle = '#111'; g.beginPath(); g.moveTo(122, 54); g.lineTo(152, 76); g.lineTo(122, 98); g.closePath(); g.fill();
      g.strokeStyle = '#c8102e'; g.lineWidth = 10; g.beginPath(); g.arc(96, 110, 66, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(50, 64); g.lineTo(142, 156); g.stroke();
      text(g, 'ON RED', 96, 214, 38, '#111');
      return c;
    },
    pxo() {
      const c = canvas(256, 256), g = c.getContext('2d');
      g.fillStyle = '#111'; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = '#f5d000'; g.lineWidth = 36; g.beginPath(); g.moveTo(40, 40); g.lineTo(216, 216); g.moveTo(216, 40); g.lineTo(40, 216); g.stroke();
      return c;
    },
    pxoText() {
      const c = canvas(256, 128), g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(4, 4, 248, 120);
      text(g, 'STOP FOR', 128, 34, 30, '#111'); text(g, 'PEDESTRIANS', 128, 70, 30, '#111'); text(g, '⇣ ⇣', 128, 104, 28, '#111');
      return c;
    },
    oneway(dir) {
      const c = canvas(256, 96), g = c.getContext('2d');
      g.fillStyle = '#111'; g.fillRect(0, 0, 256, 96);
      g.save();
      if (dir < 0) { g.translate(256, 0); g.scale(-1, 1); }
      g.fillStyle = '#fff'; g.beginPath();
      g.moveTo(20, 34); g.lineTo(180, 34); g.lineTo(180, 16); g.lineTo(240, 48); g.lineTo(180, 80); g.lineTo(180, 62); g.lineTo(20, 62); g.closePath(); g.fill();
      g.restore();
      text(g, 'ONE WAY', dir < 0 ? 156 : 100, 49, 26, '#111');
      return c;
    },
    roundabout() {
      const c = canvas(256, 256), g = c.getContext('2d');
      g.fillStyle = '#f5c400'; g.translate(128, 128); g.rotate(Math.PI / 4); g.fillRect(-88, -88, 176, 176); g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(-82, -82, 164, 164); g.setTransform(1, 0, 0, 1, 0, 0);
      g.strokeStyle = '#111'; g.lineWidth = 14;
      for (let i = 0; i < 3; i++) {
        const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        g.beginPath(); g.arc(128, 128, 44, a0 + 0.3, a0 + 1.75); g.stroke();
        const a = a0 + 0.3, x = 128 + 44 * Math.cos(a), y = 128 + 44 * Math.sin(a);
        g.fillStyle = '#111'; g.beginPath(); g.moveTo(x - 14 * Math.cos(a), y - 14 * Math.sin(a)); g.lineTo(x + 14 * Math.cos(a), y + 14 * Math.sin(a)); g.lineTo(x + 16 * Math.sin(a), y - 16 * Math.cos(a)); g.closePath(); g.fill();
      }
      return c;
    },
    streetcar() {
      const c = canvas(128, 192), g = c.getContext('2d');
      g.fillStyle = '#c8102e'; g.fillRect(0, 0, 128, 192); g.fillStyle = '#fff'; g.fillRect(10, 10, 108, 172);
      g.fillStyle = '#c8102e'; g.fillRect(24, 40, 80, 60); g.fillStyle = '#fff'; g.fillRect(34, 50, 60, 26);
      text(g, 'STREETCAR', 64, 128, 18, '#c8102e'); text(g, 'STOP', 64, 154, 24, '#c8102e');
      return c;
    },
    exit(label) {
      const c = canvas(512, 256), g = c.getContext('2d');
      g.fillStyle = '#0b6b3a'; g.fillRect(0, 0, 512, 256); g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 240);
      const parts = String(label).split('|');
      text(g, parts[0], 256, 70, 54, '#fff');
      if (parts[1]) text(g, parts[1], 256, 140, 44, '#fff');
      if (parts[2]) text(g, parts[2], 256, 205, 36, '#fff');
      return c;
    },
    kingshwy() {
      const c = canvas(192, 256), g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 192, 256);
      g.fillStyle = '#111'; g.beginPath(); g.moveTo(96, 236); g.quadraticCurveTo(16, 190, 20, 60); g.lineTo(60, 20); g.lineTo(96, 40); g.lineTo(132, 20); g.lineTo(172, 60); g.quadraticCurveTo(176, 190, 96, 236); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(96, 222); g.quadraticCurveTo(30, 184, 32, 66); g.lineTo(62, 34); g.lineTo(96, 52); g.lineTo(130, 34); g.lineTo(160, 66); g.quadraticCurveTo(162, 184, 96, 222); g.fill();
      text(g, '401', 96, 128, 64, '#111');
      return c;
    },
    windows(lit) {
      const c = canvas(128, 128), g = c.getContext('2d');
      g.fillStyle = lit ? '#000' : '#fff'; g.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const on = lit ? Math.random() < 0.45 : true;
        g.fillStyle = lit ? (on ? '#ffd98a' : '#000') : '#8aa4b8';
        g.fillRect(x * 32 + 6, y * 32 + 8, 20, 16);
      }
      return c;
    },
    glow() {
      const c = canvas(128, 128), g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,220,160,0.85)'); gr.addColorStop(0.4, 'rgba(255,200,120,0.35)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      return c;
    },
    flare() {
      const c = canvas(64, 64), g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 1, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return c;
    },
    asphalt(winter) {
      const c = canvas(256, 256), g = c.getContext('2d');
      g.fillStyle = winter ? '#6b7076' : '#4a4d52'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2600; i++) {
        const v = Math.random();
        g.fillStyle = winter ? (v < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(60,60,60,0.12)') : (v < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)');
        g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
      }
      return c;
    },
  };

  DS.Tex = {
    get(name, arg) {
      const key = name + ':' + (arg === undefined ? '' : arg);
      if (cache.has(key)) return cache.get(key);
      const t = tex(makers[name](arg));
      if (name === 'asphalt') { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      if (name === 'windows') { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      cache.set(key, t);
      return t;
    },
    clear() { cache.forEach((t) => t.dispose()); cache.clear(); },
  };
})();
