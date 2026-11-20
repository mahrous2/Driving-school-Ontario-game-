/* Examiner: scoring, violation log, praise, pass/fail. */
(function () {
  'use strict';
  const DS = window.DS;

  class Examiner {
    constructor(G) {
      this.G = G;
      this.score = 100;
      this.log = [];
      this.cool = new Map();
      this.once = new Set();
      this.criticals = 0;
      this.praises = [];
    }
    // opts: key (cooldown key), cooldown (s), once (bool), detail (extra text)
    flag(code, opts = {}) {
      const def = DS.VIOLATIONS[code];
      if (!def || !def.pts) return false;
      const G = this.G;
      if (G.finished) return false;
      const key = opts.key || code;
      if (opts.once && this.once.has(key)) return false;
      const last = this.cool.get(key);
      if (last !== undefined && G.time - last < (opts.cooldown || 8)) return false;
      this.cool.set(key, G.time);
      if (opts.once) this.once.add(key);
      const entry = { code, def, t: G.time, detail: opts.detail || '', pts: def.pts, sev: def.sev };
      this.score = Math.max(0, this.score - def.pts);
      if (def.sev === 'critical') this.criticals++;
      this.log.push(entry);
      DS.Bus.emit('violation', entry);
      return true;
    }
    praise(msg, key) {
      const G = this.G;
      key = key || msg;
      const last = this.cool.get('praise:' + key);
      if (last !== undefined && G.time - last < 20) return;
      this.cool.set('praise:' + key, G.time);
      this.praises.push({ t: G.time, msg });
      DS.Bus.emit('praise', msg);
    }
    result() {
      const passed = this.criticals === 0 && this.score >= 80;
      return { passed, score: this.score, criticals: this.criticals, log: this.log };
    }
  }
  DS.Examiner = Examiner;
})();
