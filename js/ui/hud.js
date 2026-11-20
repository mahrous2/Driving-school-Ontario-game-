/* DOM HUD: instructions, speed-limit sign, speedometer, signals, mirror checks, minimap,
 * examiner score card, violation log and toasts.
 */
(function () {
  'use strict';
  const DS = window.DS, U = DS.U;
  const $ = (id) => document.getElementById(id);

  const ARROWS = { L: '↰', R: '↱', S: '↑', U: '↶', ring: '⟲', park: 'P', done: '✓' };

  const HUD = {
    init() {
      this.el = {};
      for (const id of ['hud', 'instrArrow', 'instrText', 'instrSub', 'instrDist', 'limitSign', 'schoolBadge', 'score', 'verdict', 'vioCount', 'cpCount', 'log', 'toasts', 'hint', 'viewLabel', 'sigL', 'sigR', 'icoBelt', 'icoLights', 'icoHaz', 'icoSkid', 'gapInfo', 'stopDist', 'modeLabel', 'timer', 'chkL', 'chkM', 'chkR'])
        this.el[id] = $(id);
      this.speedo = this.hidpi($('speedo'), 240, 168);
      this.steerG = this.hidpi($('steerGauge'), 132, 132);
      this.prnd = [...document.querySelectorAll('#prnd span')];
      this.mini = $('minimap').getContext('2d');
      document.querySelectorAll('.chk').forEach((b) => b.addEventListener('click', () => DS.Input.push(b.dataset.act)));
      this.el.log.addEventListener('click', (e) => { const it = e.target.closest('.logItem'); if (it && !it.classList.contains('praise')) it.classList.toggle('open'); });
      DS.Bus.on('violation', (v) => this.onViolation(v));
      DS.Bus.on('praise', (m) => this.onPraise(m));
      DS.Bus.on('hint', (m) => this.hint(m));
      DS.Bus.on('checkpoint', () => DS.Audio.good());
    },
    reset(G) {
      this.G = G;
      this.el.log.innerHTML = '';
      this.el.toasts.innerHTML = '';
      this.el.modeLabel.textContent = G.mode === 'test' ? 'MOCK ROAD TEST · ' + G.scenario.level : 'PRACTICE · ' + G.scenario.name.toUpperCase();
      this._mapCache = null;
      const start = G.scenario.startParked ? 'Fasten your seatbelt (B). Check your mirror (X), signal left (Q), shoulder-check left (Z), then accelerate (W) to pull out when safe.' : 'Fasten your seatbelt (B), then accelerate (W). Watch the examiner\'s directions at the top.';
      this.hint(G.mode === 'test' ? 'Mock road test: follow the examiner\'s directions. ' + start : G.scenario.intro || start, 10, true);
    },

    hint(msg, secs, force) {
      const G = this.G;
      if (!G || (G.mode === 'test' && !force && !/^Camera|Emergency|Shifted|Sound|Stop completely|Reverse|Drive$/.test(msg))) return;
      const h = this.el.hint;
      h.textContent = msg; h.classList.remove('hidden');
      clearTimeout(this._ht);
      this._ht = setTimeout(() => h.classList.add('hidden'), (secs || 6) * 1000);
    },

    toast(html, cls, secs) {
      const t = document.createElement('div');
      t.className = 'toast ' + cls;
      t.innerHTML = html;
      const box = this.el.toasts;
      box.prepend(t);
      while (box.children.length > 2) box.lastChild.remove();
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, (secs || 7) * 1000);
    },

    onViolation(v) {
      const d = v.def, sev = DS.SEV[d.sev];
      const esc = (s) => String(s).replace(/</g, '&lt;');
      this.toast(
        `<div class="th"><span class="tt">${esc(d.title)}</span><span class="tp">−${v.pts}</span></div>` +
        `<div class="ts" style="color:${sev.color}">${sev.label}${d.hta && d.hta !== '—' ? ' · ' + esc(d.hta) : ''}</div>` +
        `<div class="tr">${esc(d.rule)}${v.detail ? ' ' + esc(v.detail) : ''}</div>` +
        `<div class="tm"><b>MTO Handbook:</b> ${esc(d.mto)}</div>` +
        (d.tip ? `<div class="tip">Tip: ${esc(d.tip)}</div>` : ''),
        d.sev, d.sev === 'critical' ? 10 : d.sev === 'major' ? 8.5 : 7);
      const it = document.createElement('div');
      it.className = 'logItem ' + d.sev;
      it.innerHTML = `<div class="lt"><span>${esc(d.title)}</span><span class="lp">−${v.pts}</span></div><div class="ld">${U.fmtTime(v.t)} · ${esc(d.rule)} ${esc(v.detail || '')}<br><i>${esc(d.mto)}</i><br>${esc(d.hta || '')}</div>`;
      this.el.log.prepend(it);
      DS.Audio.violation(d.sev);
    },
    onPraise(m) {
      if (!this.G || this.G.mode === 'test') return;
      this.toast(`<div class="th"><span class="tt">✔ ${m}</span></div>`, 'praise', 3.5);
      const it = document.createElement('div');
      it.className = 'logItem praise';
      it.innerHTML = `<div class="lt"><span>✔ ${m}</span></div>`;
      this.el.log.prepend(it);
      DS.Audio.good();
    },

    update(G) {
      const P = G.player, el = this.el, pl = G.playerLoc;
      // instructions
      const ins = G.instr || {};
      el.instrText.textContent = ins.text || '';
      el.instrSub.textContent = ins.sub || '';
      el.instrArrow.textContent = ARROWS[ins.move] || '↑';
      el.instrDist.textContent = ins.dist ? (ins.dist > 1000 ? (ins.dist / 1000).toFixed(1) + ' km' : Math.max(0, Math.round(ins.dist / 5) * 5) + ' m') : '';
      // limit
      const lim = pl.limit;
      if (lim) { el.limitSign.querySelector('.ln').textContent = pl.schoolZone ? pl.schoolZone.limit : lim; el.limitSign.classList.toggle('over', P.kmh > (pl.schoolZone ? pl.schoolZone.limit : lim) + 3); }
      el.schoolBadge.classList.toggle('hidden', !pl.schoolZone);
      // score
      const E = G.examiner;
      el.score.textContent = Math.round(E.score);
      el.score.style.color = E.criticals ? 'var(--red)' : E.score < 80 ? 'var(--yellow)' : 'var(--text)';
      const v = el.verdict;
      if (E.criticals) { v.className = 'fail'; v.textContent = G.mode === 'test' ? 'FAIL — dangerous action' : 'Would fail'; }
      else if (E.score < 80) { v.className = 'fail'; v.textContent = 'Below pass mark'; }
      else if (E.score < 90) { v.className = 'warn'; v.textContent = 'Careful'; }
      else { v.className = 'ok'; v.textContent = 'On track'; }
      el.vioCount.textContent = E.log.length + (E.log.length === 1 ? ' violation' : ' violations');
      el.cpCount.textContent = 'Checkpoint ' + Math.min(G.cpIndex, G.scenario.checkpoints.length) + '/' + G.scenario.checkpoints.length;
      el.timer.textContent = U.fmtTime(G.time);
      // indicators
      el.sigL.classList.toggle('on', (P.sigL || P.hazards) && G.blink);
      el.sigR.classList.toggle('on', (P.sigR || P.hazards) && G.blink);
      for (const sp of this.prnd) sp.classList.toggle('on', sp.dataset.g === P.gear);
      el.icoBelt.className = 'tl ' + (P.seatbelt ? 'on' : 'warn');
      el.icoLights.className = 'tl ' + (P.headlights ? 'on' : '');
      el.icoHaz.className = 'tl ' + (P.hazards && G.blink ? 'amber' : '');
      el.icoSkid.className = 'tl ' + (P.skidding ? 'amber' : P.mu < 0.6 ? 'blue' : '');
      el.icoSkid.textContent = P.skidding ? 'SKID' : P.mu < 0.2 ? 'ICE' : 'GRIP ' + Math.round(P.mu * 100) + '%';
      const gi = pl.gapInfo;
      const need = G.weather === 'snow' ? 4.5 : G.weather === 'rain' ? 3.6 : 3;
      if (gi && gi.tg !== null && gi.tg < 8 && P.speed > 3) {
        el.gapInfo.textContent = 'FOLLOWING GAP  ' + gi.tg.toFixed(1) + ' s';
        el.gapInfo.className = 'readout ' + (gi.tg < need / 2 ? 'warn' : gi.tg < need ? 'amber' : 'on');
      } else { el.gapInfo.textContent = 'FOLLOWING GAP  —'; el.gapInfo.className = 'readout'; }
      el.stopDist.textContent = 'Stopping distance ' + Math.round(P.stoppingDistance()) + ' m' + (P.mu < 0.6 ? ' · slippery' : '');
      // checks
      const pct = (t) => Math.max(0, 1 - (G.time - t) / 5) * 100;
      el.chkL.querySelector('i').style.width = pct(P.lastShoulderL) + '%';
      el.chkM.querySelector('i').style.width = pct(P.lastMirror) + '%';
      el.chkR.querySelector('i').style.width = pct(P.lastShoulderR) + '%';
      el.chkL.classList.toggle('active', G.time - P.lastShoulderL < 1);
      el.chkM.classList.toggle('active', G.time - P.lastMirror < 1);
      el.chkR.classList.toggle('active', G.time - P.lastShoulderR < 1);
      el.viewLabel.textContent = DS.VIEW_NAMES[DS.Renderer.view] + ' · V to change';
      this.drawSpeedo(G);
      if (this.steerG) this.drawSteer(G);
      this.drawMinimap(G);
    },

    hidpi(cv, w, h) {
      const r = Math.min(2, window.devicePixelRatio || 1);
      cv.width = w * r; cv.height = h * r;
      const g = cv.getContext('2d'); g.scale(r, r); g.W = w; g.H = h;
      return g;
    },
    drawSpeedo(G) {
      const g = this.speedo, P = G.player, W = g.W, H = g.H;
      g.clearRect(0, 0, W, H);
      const cx = W / 2, cy = 104, R = 92, max = 180;
      const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
      const ang = (v) => a0 + (a1 - a0) * Math.min(v, max) / max;
      const kmh = P.kmh;
      const lim = G.playerLoc.schoolZone ? G.playerLoc.schoolZone.limit : G.playerLoc.limit;
      // bezel + track
      g.lineCap = 'round';
      g.lineWidth = 10; g.strokeStyle = '#0d1218'; g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
      // live speed arc (gradient), red once over the limit
      const over = lim && kmh > lim + 2;
      const grad = g.createLinearGradient(cx - R, 0, cx + R, 0);
      grad.addColorStop(0, '#1f6feb'); grad.addColorStop(1, over ? '#ff4b4b' : '#29d3ff');
      g.strokeStyle = grad; g.shadowColor = over ? '#ff4b4b' : '#29d3ff'; g.shadowBlur = 12;
      if (kmh > 0.5) { g.beginPath(); g.arc(cx, cy, R, a0, ang(kmh)); g.stroke(); }
      g.shadowBlur = 0;
      // speed-limit marker
      if (lim) {
        const a = ang(lim);
        g.strokeStyle = '#ff4b4b'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 9), cy + Math.sin(a) * (R - 9)); g.lineTo(cx + Math.cos(a) * (R + 9), cy + Math.sin(a) * (R + 9)); g.stroke();
      }
      // ticks
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let v = 0; v <= max; v += 10) {
        const a = ang(v), major = v % 20 === 0;
        g.strokeStyle = major ? '#c9d4de' : '#4c5967'; g.lineWidth = major ? 2 : 1.2;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16)); g.lineTo(cx + Math.cos(a) * (R - (major ? 24 : 20)), cy + Math.sin(a) * (R - (major ? 24 : 20))); g.stroke();
        if (major) { g.fillStyle = '#8796a5'; g.font = '600 10px system-ui'; g.fillText(v, cx + Math.cos(a) * (R - 35), cy + Math.sin(a) * (R - 35)); }
      }
      // needle
      const a = ang(kmh);
      g.strokeStyle = '#ff6a3d'; g.lineWidth = 3; g.shadowColor = '#ff6a3d'; g.shadowBlur = 8;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30); g.lineTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12)); g.stroke();
      g.shadowBlur = 0;
      // hub with digital readout
      const hub = g.createRadialGradient(cx, cy - 6, 4, cx, cy, 36);
      hub.addColorStop(0, '#1a222c'); hub.addColorStop(1, '#06090c');
      g.fillStyle = hub; g.beginPath(); g.arc(cx, cy, 34, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = over ? '#ff6b6b' : '#eef3f7'; g.font = '800 30px system-ui'; g.fillText(Math.round(kmh), cx, cy - 2);
      g.fillStyle = '#7d8b98'; g.font = '600 9px system-ui'; g.fillText('km/h', cx, cy + 18);
      g.fillStyle = '#5d6b78'; g.font = '700 10px system-ui'; g.fillText((P.odometer / 1000).toFixed(1) + ' km', cx, H - 8);
    },
    drawSteer(G) {
      const g = this.steerG, P = G.player, W = g.W, H = g.H, cx = W / 2, cy = H / 2 - 6;
      g.clearRect(0, 0, W, H);
      const wheelDeg = -P.steerIn * 450; // steering-wheel angle (lock-to-lock ~2.5 turns)
      const roadDeg = (P.steer || 0) * 180 / Math.PI;
      // arc scale
      g.lineCap = 'round';
      g.strokeStyle = '#0d1218'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, 50, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
      const t = U.clamp(-P.steerIn, -1, 1);
      g.strokeStyle = Math.abs(t) > 0.8 ? '#ffb000' : '#29d3ff'; g.shadowColor = g.strokeStyle; g.shadowBlur = 8;
      g.beginPath(); g.arc(cx, cy, 50, Math.PI * 1.5, Math.PI * 1.5 + t * Math.PI * 0.35, t < 0); g.stroke(); g.shadowBlur = 0;
      // wheel icon
      g.save(); g.translate(cx, cy + 4); g.rotate(wheelDeg * Math.PI / 180);
      g.strokeStyle = '#c9d4de'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 5; g.beginPath(); g.moveTo(-28, 4); g.lineTo(-9, 2); g.moveTo(28, 4); g.lineTo(9, 2); g.moveTo(0, 10); g.lineTo(0, 28); g.stroke();
      g.fillStyle = '#c9d4de'; g.beginPath(); g.arc(0, 2, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#d52b1e'; g.fillRect(-3, -33, 6, 7);
      g.restore();
      g.textAlign = 'center'; g.fillStyle = '#c9d4de'; g.font = '700 12px system-ui';
      g.fillText(Math.abs(wheelDeg) < 1 ? 'STRAIGHT' : Math.round(Math.abs(wheelDeg)) + '° ' + (wheelDeg < 0 ? 'L' : 'R'), cx, H - 14);
      g.fillStyle = '#5d6b78'; g.font = '600 9px system-ui'; g.fillText('wheels ' + Math.abs(roadDeg).toFixed(1) + '°', cx, H - 2);
    },

    drawMinimap(G) {
      const g = this.mini, P = G.player, net = G.net, S = 200;
      const scale = G.net.roads.some((r) => r.kind === 'highway') ? 0.32 : 0.42;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, S, S);
      g.save();
      g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.clip();
      g.fillStyle = G.weather === 'snow' ? '#3a4652' : '#17241a'; g.fillRect(0, 0, S, S);
      // heading-up
      g.translate(S / 2, S / 2 + 30);
      g.rotate(P.h - Math.PI / 2);
      g.scale(scale, -scale);
      g.translate(-P.x, -P.y);
      g.fillStyle = '#5c6670';
      for (const r of net.roads) {
        const a = r.toXY(r.a0, r.uMin), b = r.toXY(r.a1, r.uMax);
        g.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      }
      g.strokeStyle = '#5c6670';
      for (const rp of net.ramps) { g.lineWidth = rp.width; g.beginPath(); rp.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); }
      for (const n of net.nodes) if (n.ring) { g.lineWidth = n.ring.r1 - n.ring.r0; g.beginPath(); g.arc(n.x, n.y, (n.ring.r0 + n.ring.r1) / 2, 0, Math.PI * 2); g.stroke(); }
      // route
      if (G.route && G.route.steps) {
        g.strokeStyle = '#29d3ff'; g.lineWidth = 4 / scale; g.beginPath(); g.moveTo(P.x, P.y);
        g.lineTo(G.route.start.x, G.route.start.y);
        for (const e of G.route.steps) { if (e.to) g.lineTo(e.to.x, e.to.y); else { const end = e.road.toXY(e.dir > 0 ? e.road.a1 : e.road.a0, 0); g.lineTo(end.x, end.y); } }
        g.stroke();
      }
      // checkpoint
      const cp = G.scenario.checkpoints[G.cpIndex];
      if (cp) {
        let p = null;
        if (cp.road) p = net.road(cp.road).toXY(cp.s, net.road(cp.road).laneU(cp.dir, 0));
        else if (cp.ramp) { const rp = net.ramps.find((r) => r.id === cp.ramp); p = rp.poly.at(cp.s); }
        if (p) { g.fillStyle = cp.type === 'park' ? '#3ddc84' : '#f5c542'; g.beginPath(); g.arc(p.x, p.y, 6 / scale, 0, Math.PI * 2); g.fill(); }
      }
      // vehicles
      for (const v of G.traffic.vehicles) {
        g.fillStyle = v.emergency ? (Math.floor(G.time * 4) % 2 ? '#ff3030' : '#3060ff') : v.type === 'schoolbus' ? '#ffb800' : v.type === 'streetcar' ? '#d52b1e' : v.kind === 'bike' ? '#3ddc84' : '#c9d1d9';
        g.save(); g.translate(v.x, v.y); g.rotate(v.h); g.fillRect(-v.len / 2, -v.wid / 2, v.len, v.wid); g.restore();
      }
      g.fillStyle = '#ffd166';
      for (const p of G.peds.list) { g.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6); }
      g.restore();
      // player arrow (always centre, pointing up)
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#29d3ff';
      g.beginPath(); g.moveTo(S / 2, S / 2 + 30 - 9); g.lineTo(S / 2 + 6, S / 2 + 30 + 7); g.lineTo(S / 2, S / 2 + 30 + 3); g.lineTo(S / 2 - 6, S / 2 + 30 + 7); g.closePath(); g.fill();
      // north marker
      const na = P.h - Math.PI; // world north after the heading-up rotation
      g.fillStyle = '#e8edf2'; g.font = 'bold 12px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('N', S / 2 + Math.cos(na) * 84, S / 2 + Math.sin(na) * 84);
    },
  };
  DS.HUD = HUD;
})();
