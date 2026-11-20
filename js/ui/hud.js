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
      for (const id of ['hud', 'instrArrow', 'instrText', 'instrSub', 'instrDist', 'limitSign', 'schoolBadge', 'score', 'verdict', 'vioCount', 'cpCount', 'log', 'toasts', 'hint', 'viewLabel', 'sigL', 'sigR', 'gear', 'icoBelt', 'icoLights', 'icoHaz', 'icoSkid', 'gapInfo', 'stopDist', 'modeLabel', 'timer', 'chkL', 'chkM', 'chkR'])
        this.el[id] = $(id);
      this.speedo = $('speedo').getContext('2d');
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
      el.gear.textContent = P.gear;
      el.icoBelt.className = 'ico ' + (P.seatbelt ? 'on' : 'warn');
      el.icoBelt.textContent = P.seatbelt ? '⛓ BELT' : '⛓ BELT!';
      el.icoLights.className = 'ico ' + (P.headlights ? 'on' : '');
      el.icoHaz.className = 'ico ' + (P.hazards && G.blink ? 'amber' : P.hazards ? 'on' : '');
      el.icoSkid.className = 'ico ' + (P.skidding ? 'amber' : G.weather === 'snow' ? 'on' : '');
      el.icoSkid.textContent = P.skidding ? '≋ SKID!' : P.mu < 0.2 ? '≋ ICE' : '≋ GRIP ' + Math.round(P.mu * 100) + '%';
      const gi = pl.gapInfo;
      const need = G.weather === 'snow' ? 4.5 : G.weather === 'rain' ? 3.6 : 3;
      if (gi && gi.tg !== null && gi.tg < 8 && P.speed > 3) {
        el.gapInfo.textContent = 'GAP ' + gi.tg.toFixed(1) + ' s';
        el.gapInfo.className = 'ico ' + (gi.tg < need / 2 ? 'warn' : gi.tg < need ? 'amber' : 'on');
      } else { el.gapInfo.textContent = 'GAP —'; el.gapInfo.className = 'ico'; }
      el.stopDist.textContent = 'Stopping distance: ' + Math.round(P.stoppingDistance()) + ' m' + (P.mu < 0.6 ? ' (slippery!)' : '');
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
      this.drawMinimap(G);
    },

    drawSpeedo(G) {
      const g = this.speedo, P = G.player, W = 220, H = 150;
      g.clearRect(0, 0, W, H);
      const cx = 110, cy = 112, R = 92, max = 180;
      const a0 = Math.PI * 0.85, a1 = Math.PI * 2.15;
      const ang = (v) => a0 + (a1 - a0) * Math.min(v, max) / max;
      g.lineWidth = 8; g.strokeStyle = '#1e2733'; g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
      const lim = G.playerLoc.schoolZone ? G.playerLoc.schoolZone.limit : G.playerLoc.limit;
      if (lim) { g.strokeStyle = 'rgba(255,75,75,.75)'; g.beginPath(); g.arc(cx, cy, R, ang(lim), a1); g.stroke(); }
      g.fillStyle = '#9aa7b4'; g.font = '11px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let v = 0; v <= max; v += 20) {
        const a = ang(v);
        g.strokeStyle = '#9aa7b4'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12)); g.lineTo(cx + Math.cos(a) * (R - 4), cy + Math.sin(a) * (R - 4)); g.stroke();
        g.fillText(v, cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24));
      }
      const kmh = P.kmh;
      const a = ang(kmh);
      g.strokeStyle = kmh > (lim || 999) + 5 ? '#ff4b4b' : '#29d3ff'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10)); g.stroke();
      g.fillStyle = '#e8edf2'; g.font = 'bold 34px system-ui'; g.fillText(Math.round(kmh), cx, cy - 18);
      g.fillStyle = '#9aa7b4'; g.font = '11px system-ui'; g.fillText('km/h', cx, cy + 6);
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
