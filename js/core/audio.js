/* Minimal Web Audio: engine hum, indicator ticks, siren, chimes. All synthesised — no assets. */
(function () {
  'use strict';
  const DS = window.DS;
  const A = {
    ctx: null, enabled: true, muted: false,
    init() {
      if (this.ctx) return;
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        const c = this.ctx;
        this.master = c.createGain(); this.master.gain.value = 0.5; this.master.connect(c.destination);
        // engine
        this.eng = c.createOscillator(); this.eng.type = 'sawtooth'; this.eng.frequency.value = 40;
        this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 380;
        this.engG = c.createGain(); this.engG.gain.value = 0;
        this.eng.connect(this.engF); this.engF.connect(this.engG); this.engG.connect(this.master); this.eng.start();
        // siren
        this.sir = c.createOscillator(); this.sir.type = 'square'; this.sir.frequency.value = 700;
        this.sirF = c.createBiquadFilter(); this.sirF.type = 'lowpass'; this.sirF.frequency.value = 1800;
        this.sirG = c.createGain(); this.sirG.gain.value = 0;
        this.sir.connect(this.sirF); this.sirF.connect(this.sirG); this.sirG.connect(this.master); this.sir.start();
      } catch (e) { this.ctx = null; }
    },
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
    setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m || !this.enabled ? 0 : 0.5; },
    update(G) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime, P = G.player;
      const v = P.speed;
      const running = !G.paused && !G.finished;
      this.eng.frequency.setTargetAtTime(38 + v * 2.6 + P.throttle * 18, t, 0.1);
      this.engG.gain.setTargetAtTime(running ? 0.05 + P.throttle * 0.05 : 0, t, 0.15);
      // nearest active siren
      let d = 1e9;
      for (const e of G.emergencies) if (e.lightsOn && !e.static && e.siren) d = Math.min(d, Math.hypot(e.x - P.x, e.y - P.y));
      const vol = running && d < 400 ? Math.min(0.12, 18 / (d + 30)) : 0;
      this.sirG.gain.setTargetAtTime(vol, t, 0.2);
      const wail = 650 + 450 * (0.5 + 0.5 * Math.sin(G.time * 2.2));
      this.sir.frequency.setTargetAtTime(wail, t, 0.05);
    },
    beep(freq, dur, type, vol) {
      if (!this.ctx || this.muted || !this.enabled) return;
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.value = vol || 0.12; g.gain.setTargetAtTime(0, c.currentTime + dur * 0.6, dur * 0.3);
      o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + dur + 0.2);
    },
    tick(on) { this.beep(on ? 1800 : 1400, 0.03, 'square', 0.05); },
    violation(sev) {
      if (sev === 'critical') { this.beep(220, 0.35, 'sawtooth', 0.16); setTimeout(() => this.beep(165, 0.45, 'sawtooth', 0.16), 260); }
      else if (sev === 'major') { this.beep(440, 0.2, 'triangle', 0.14); setTimeout(() => this.beep(330, 0.3, 'triangle', 0.14), 180); }
      else this.beep(660, 0.18, 'triangle', 0.1);
    },
    good() { this.beep(880, 0.12, 'sine', 0.08); setTimeout(() => this.beep(1320, 0.16, 'sine', 0.08), 110); },
    crash() {
      if (!this.ctx || this.muted) return;
      const c = this.ctx, len = 0.5 * c.sampleRate, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      const s = c.createBufferSource(), g = c.createGain(); g.gain.value = 0.35; s.buffer = buf; s.connect(g); g.connect(this.master); s.start();
    },
    horn() { this.beep(392, 0.4, 'square', 0.08); this.beep(330, 0.4, 'square', 0.06); },
  };
  DS.Audio = A;
})();
