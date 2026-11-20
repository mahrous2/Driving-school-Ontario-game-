/* Start menu, pause menu, help and the end-of-drive examiner report. */
(function () {
  'use strict';
  const DS = window.DS, U = DS.U;
  const $ = (id) => document.getElementById(id);

  const Menu = {
    selected: 'downtown',
    init() {
      const list = $('scenarioList');
      list.innerHTML = '';
      for (const sc of DS.SCENARIOS) {
        const b = document.createElement('button');
        b.className = 'card' + (sc.id === this.selected ? ' sel' : '');
        b.dataset.id = sc.id;
        b.innerHTML = `<span class="cl">${sc.level}</span><span class="cn">${sc.name}</span><span class="cd">${sc.desc}</span><ul>${sc.skills.map((s) => '<li>' + s + '</li>').join('')}</ul>`;
        b.addEventListener('click', () => {
          this.selected = sc.id;
          list.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.id === sc.id));
          if (sc.defaultMode) $('optMode').value = sc.defaultMode;
        });
        b.addEventListener('dblclick', () => this.start());
        list.appendChild(b);
      }
      try {
        const saved = JSON.parse(localStorage.getItem('ors-opts') || '{}');
        for (const [k, v] of Object.entries(saved)) { const e = $(k); if (!e) continue; if (e.type === 'checkbox') e.checked = v; else e.value = v; }
        if (saved.scenario) { this.selected = saved.scenario; list.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.id === this.selected)); }
      } catch (e) { /* storage unavailable */ }
      $('btnStart').onclick = () => this.start();
      $('btnHelp').onclick = () => this.show('help');
      document.querySelectorAll('.closeHelp').forEach((b) => (b.onclick = () => this.hide('help')));
      document.querySelectorAll('.openHelp').forEach((b) => (b.onclick = () => this.show('help')));
      $('btnResume').onclick = () => DS.Game.togglePause(false);
      $('btnRestart').onclick = () => { this.hide('pause'); DS.Game.start(DS.Game.cfg); };
      $('btnEnd').onclick = () => { this.hide('pause'); DS.Game.finish('ended'); };
      $('btnMenu').onclick = () => { this.hide('pause'); DS.Game.toMenu(); };
      $('btnRetry').onclick = () => { this.hide('report'); DS.Game.start(DS.Game.cfg); };
      $('btnReportMenu').onclick = () => { this.hide('report'); DS.Game.toMenu(); };
    },
    show(id) { $(id).classList.remove('hidden'); },
    hide(id) { $(id).classList.add('hidden'); },
    config() {
      const cfg = {
        scenario: this.selected, weather: $('optWeather').value, time: $('optTime').value, mode: $('optMode').value,
        view: $('optView').value, pauseOnViolation: $('optPause').checked, mirrors: $('optMirrors').checked, sound: $('optSound').checked,
      };
      try { localStorage.setItem('ors-opts', JSON.stringify({ optWeather: cfg.weather, optTime: cfg.time, optMode: cfg.mode, optView: cfg.view, optPause: cfg.pauseOnViolation, optMirrors: cfg.mirrors, optSound: cfg.sound, scenario: cfg.scenario })); } catch (e) { /* ignore */ }
      return cfg;
    },
    start() {
      const cfg = this.config();
      this.hide('menu');
      DS.Audio.init(); DS.Audio.resume();
      DS.Audio.enabled = cfg.sound; DS.Audio.setMuted(!cfg.sound);
      DS.Game.start(cfg);
    },

    report(G, reason) {
      const res = G.examiner.result();
      const esc = (s) => String(s || '').replace(/</g, '&lt;');
      const passed = res.passed && reason !== 'ended-early';
      const head = $('reportHead'), body = $('reportBody');
      const complete = G.cpIndex >= G.scenario.checkpoints.length;
      const label = G.mode === 'test' ? (passed && complete ? 'PASS' : 'FAIL') : (passed ? 'PASS standard' : 'Below pass standard');
      const dist = (G.player.odometer / 1000).toFixed(2);
      head.innerHTML = `<div class="rHead"><div class="rBadge ${passed && (complete || G.mode !== 'test') ? 'pass' : 'fail'}">${label}</div>
        <div><h2 style="margin:0">${esc(G.scenario.name)}</h2><div class="rStats">
          <span><b>${Math.round(res.score)}</b>score / 100</span><span><b>${res.log.length}</b>violations</span><span><b>${res.criticals}</b>dangerous actions</span>
          <span><b>${U.fmtTime(G.time)}</b>time</span><span><b>${dist} km</b>driven</span><span><b>${Math.min(G.cpIndex, G.scenario.checkpoints.length)}/${G.scenario.checkpoints.length}</b>checkpoints</span>
        </div></div></div>
        <p style="color:var(--muted);font-size:13px">${reasonText(reason, G)} Conditions: ${G.weather === 'snow' ? 'Winter (snow / black ice)' : G.weather}${G.night ? ', night' : ''}. Pass standard: 80+ points and no dangerous actions.</p>`;
      // group violations by code
      const groups = new Map();
      for (const v of res.log) { const g = groups.get(v.code) || { v, n: 0, pts: 0 }; g.n++; g.pts += v.pts; groups.set(v.code, g); }
      let html = '<div class="rList">';
      if (!groups.size) html += '<div class="rItem praise"><div class="rt"><span>No violations recorded — excellent driving!</span></div></div>';
      const order = { critical: 0, major: 1, minor: 2 };
      for (const g of [...groups.values()].sort((a, b) => order[a.v.sev] - order[b.v.sev] || b.pts - a.pts)) {
        const d = g.v.def;
        html += `<div class="rItem ${d.sev}"><div class="rt"><span>${esc(d.title)}${g.n > 1 ? ' ×' + g.n : ''}</span><span style="color:var(--red)">−${g.pts}</span></div>
          <div class="rm">${esc(d.rule)}</div><div class="rm"><b style="color:var(--accent)">MTO Handbook:</b> ${esc(d.mto)}</div>
          <div class="rx">${esc(d.hta)} · ${DS.SEV[d.sev].label}${d.tip ? ' · Tip: ' + esc(d.tip) : ''}</div></div>`;
      }
      const praises = [...new Set(G.examiner.praises.map((p) => p.msg))];
      if (praises.length) html += '<h3>What you did well</h3>' + praises.map((p) => `<div class="rItem praise"><div class="rt"><span>✔ ${esc(p)}</span></div></div>`).join('');
      html += '</div>';
      body.innerHTML = html;
      this.show('report');
    },
  };
  function reasonText(r, G) {
    if (r === 'complete') return 'Route completed.';
    if (r === 'autofail') return 'The examiner ended the test after a dangerous action.';
    if (r === 'ended') return 'Drive ended by the student' + (G.cpIndex < G.scenario.checkpoints.length ? ' before the route was finished.' : '.');
    return '';
  }
  DS.Menu = Menu;
})();
