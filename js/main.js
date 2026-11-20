/* Game bootstrap and main loop. */
(function () {
  'use strict';
  const DS = window.DS, U = DS.U, C = DS.C;

  const FRICTION = { clear: 1.0, rain: 0.72, snow: 0.38 };
  const ICE_MU = 0.12;

  const Game = {
    G: null, cfg: null,
    init() {
      DS.Input.init();
      const canvas = document.getElementById('gl');
      try { DS.Renderer.init(canvas); } catch (e) { console.error(e); document.getElementById('noWebGL').classList.remove('hidden'); return; }
      DS.HUD.init();
      DS.Menu.init();
      DS.Bus.on('violation', (v) => {
        const G = this.G;
        if (!G) return;
        if (G.settings.pauseOnViolation && (v.sev === 'major' || v.sev === 'critical')) G.freeze = v.sev === 'critical' ? 1.4 : 0.8;
        if (G.mode === 'test' && v.sev === 'critical' && !G.failPending) G.failPending = 3.2;
      });
      DS.Bus.on('crash', () => DS.Audio.crash());
      window.addEventListener('blur', () => { if (this.G && !this.G.finished && !this.G.paused) this.togglePause(true); });
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
      // ?scenario=highway&autostart=1 for quick testing / sharing
      const qp = new URLSearchParams(location.search);
      if (qp.get('scenario')) { DS.Menu.selected = qp.get('scenario'); document.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.id === DS.Menu.selected)); }
      if (qp.get('weather')) document.getElementById('optWeather').value = qp.get('weather');
      if (qp.get('view')) document.getElementById('optView').value = qp.get('view');
      if (qp.get('autostart')) DS.Menu.start();
    },

    start(cfg) {
      this.cfg = cfg;
      const sc = DS.SCENARIOS.find((s) => s.id === cfg.scenario) || DS.SCENARIOS[0];
      const net = new DS.RoadNet(sc.map());
      const G = {
        time: 0, net, scenario: sc, weather: cfg.weather, night: cfg.time === 'night', mode: cfg.mode,
        settings: { pauseOnViolation: cfg.pauseOnViolation, mirrors: cfg.mirrors, mirrorQuality: 'high' },
        emergencies: [], events: [], world: { obstacles: [], iceRects: [] }, schoolActive: sc.schoolActive !== false,
        blink: false, paused: false, finished: false, freeze: 0, headAnim: null, cpIndex: 0, _tick: 0,
      };
      this.G = G;
      // ---- student car ----
      const st = sc.start;
      let x, y, h;
      if (st.ramp) {
        const rp = net.ramps.find((r) => r.id === st.ramp);
        const p = rp.poly.at(st.s); x = p.x; y = p.y; h = p.heading;
      } else {
        const r = net.road(st.road), dir = st.dir;
        const bike = r.bike ? C.BIKE_W : 0;
        const q = st.parked ? r.qCurb(dir) + bike + (r.sidewalk ? -0.95 - bike : 0.3) : r.laneU(dir, r.n(dir) - 1) * dir;
        const p = r.toXY(st.s, dir * (st.parked ? q : q));
        x = p.x; y = p.y; h = r.heading(dir);
      }
      const P = (G.player = new DS.PlayerCar(x, y, h));
      P.gear = 'P';
      P.headlights = false;
      G.traffic = new DS.Traffic(G, net);
      G.peds = new DS.Peds(G, net);
      G.examiner = new DS.Examiner(G);
      G.scenario.startParked = st.parked;
      DS.Rules.init(G);
      DS.Nav.init(G);
      DS.Renderer.view = cfg.view || 'cockpit';
      DS.Renderer.setup(G);
      G.inView = (px, py) => DS.Renderer.inView(px, py);
      if (sc.setup) sc.setup(G);
      // initial traffic
      for (let i = 0; i < (sc.traffic.cars || 0) * 3 && G.traffic.vehicles.filter((v) => v.kind === 'veh').length < sc.traffic.cars; i++) {
        if (sc.spawn) sc.spawn(G, G.traffic); else G.traffic.trySpawn(30, 250);
      }
      for (let i = 0; i < (sc.traffic.bikes || 0); i++) G.traffic.spawnBike(20, 220);
      for (let i = 0; i < (sc.traffic.peds || 0) / 2; i++) G.peds.spawnCrosswalkPed();
      DS.HUD.reset(G);
      document.getElementById('hud').classList.remove('hidden');
      ['menu', 'report', 'pause'].forEach((id) => DS.Menu.hide(id));
      DS.Rules.update(0); DS.Nav.update(0);
    },

    togglePause(force) {
      const G = this.G;
      if (!G || G.finished) return;
      G.paused = force !== undefined ? force : !G.paused;
      if (G.paused) DS.Menu.show('pause'); else { DS.Menu.hide('pause'); DS.Menu.hide('help'); }
    },
    finish(reason) {
      const G = this.G;
      if (!G || G.finished) return;
      G.finished = true;
      DS.Menu.report(G, reason);
    },
    toMenu() {
      if (this.G) this.G.finished = true;
      document.getElementById('hud').classList.add('hidden');
      DS.Menu.show('menu');
    },

    handleAction(a) {
      const G = this.G;
      if (!G) return;
      const P = G.player;
      if (a === 'pause') { if (!document.getElementById('help').classList.contains('hidden')) { DS.Menu.hide('help'); return; } this.togglePause(); return; }
      if (a === 'help') { this.togglePause(true); DS.Menu.show('help'); return; }
      if (a === 'mute') { DS.Audio.setMuted(!DS.Audio.muted); DS.Bus.emit('hint', DS.Audio.muted ? 'Sound muted' : 'Sound on'); return; }
      if (G.paused || G.finished) return;
      switch (a) {
        case 'signalLeft': P.setSignal(-1, G.time); break;
        case 'signalRight': P.setSignal(1, G.time); break;
        case 'hazards': P.hazards = !P.hazards; break;
        case 'headlights': P.headlights = !P.headlights; break;
        case 'seatbelt': P.seatbelt = !P.seatbelt; if (P.seatbelt) DS.Audio.beep(1200, 0.08); break;
        case 'reverse':
          if (P.speed < 0.6) { P.gear = P.gear === 'R' ? 'D' : 'R'; DS.Bus.emit('hint', P.gear === 'R' ? 'Reverse — check behind you (X / Z / C) before backing up.' : 'Drive'); }
          else DS.Bus.emit('hint', 'Stop completely before changing gear.');
          break;
        case 'park': if (P.speed < 0.6) P.gear = 'P'; break;
        case 'checkLeft': P.lastShoulderL = G.time; G.headAnim = { dir: -1, t0: G.time }; break;
        case 'checkRight': P.lastShoulderR = G.time; G.headAnim = { dir: 1, t0: G.time }; break;
        case 'checkMirror': P.lastMirror = G.time; break;
        case 'camera': DS.Renderer.cycleView(); break;
        case 'zoomIn': DS.Renderer.zoom = U.clamp(DS.Renderer.zoom / 1.25, 0.4, 4); break;
        case 'zoomOut': DS.Renderer.zoom = U.clamp(DS.Renderer.zoom * 1.25, 0.4, 4); break;
        case 'horn': DS.Audio.horn(); break;
        default: break;
      }
    },

    step(h) {
      const G = this.G, P = G.player, I = DS.Input;
      G.time += h;
      for (const n of G.net.nodes) if (n.sig) n.sig.t += h;
      // tyre-road friction
      let mu = FRICTION[G.weather] || 1;
      if (G.weather === 'snow') for (const r of G.world.iceRects) if (P.x > r.x0 && P.x < r.x1 && P.y > r.y0 && P.y < r.y1) { mu = ICE_MU; break; }
      const surf = G.playerLoc && G.playerLoc.loc ? G.playerLoc.loc.surface : 'road';
      if (surf !== 'road' && surf !== 'median') mu *= 0.75;
      P.mu = mu;
      const inp = { throttle: I.held('throttle'), brake: I.held('brake'), left: I.held('left'), right: I.held('right') };
      if (P.gear === 'P' && inp.throttle && P.speed < 0.3) { P.gear = 'D'; DS.Bus.emit('hint', 'Shifted to Drive.'); }
      P.update(h, inp, G.time);
      G.blink = P.blink;
      G.traffic.update(h);
      G.peds.update(h);
      DS.Rules.update(h);
      DS.Nav.update(h);
      G._tick += h;
      if (G._tick > 1) { G._tick = 0; if (G.scenario.tick) G.scenario.tick(G); }
      // keep the student inside the map
      const b = G.net.bounds;
      if (P.x < b.x0 || P.x > b.x1 || P.y < b.y0 || P.y > b.y1) { P.x = U.clamp(P.x, b.x0, b.x1); P.y = U.clamp(P.y, b.y0, b.y1); P.stopDead(); }
    },

    frame(ts) {
      const dtReal = Math.min(0.1, (ts - this.last) / 1000);
      this.last = ts;
      for (const a of DS.Input.drain()) this.handleAction(a);
      const G = this.G;
      if (G && !G.paused && !G.finished) {
        if (G.freeze > 0) G.freeze -= dtReal;
        else {
          this.acc = Math.min((this.acc || 0) + dtReal, 0.1);
          const h = 1 / 60;
          let n = 0;
          while (this.acc >= h && n < 6) { this.step(h); this.acc -= h; n++; }
        }
        if (G.failPending) { G.failPending -= dtReal; if (G.failPending <= 0) this.finish('autofail'); }
        if (G.completePending) { G.completePending -= dtReal; if (G.completePending <= 0) this.finish('complete'); }
      }
      if (G) {
        try {
          DS.Renderer.render(G, dtReal);
          DS.HUD.update(G);
          DS.Audio.update(G);
        } catch (e) { console.error(e); }
      }
      requestAnimationFrame((t) => this.frame(t));
    },
  };
  DS.Game = Game;
  window.addEventListener('DOMContentLoaded', () => Game.init());
})();
