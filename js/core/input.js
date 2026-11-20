/* Keyboard input: continuous axes + edge-triggered actions */
(function () {
  'use strict';
  const DS = window.DS;

  const BINDINGS = {
    throttle: ['KeyW', 'ArrowUp'],
    brake: ['KeyS', 'ArrowDown', 'Space'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
  };
  const ACTIONS = {
    KeyQ: 'signalLeft', KeyE: 'signalRight', KeyH: 'hazards', KeyL: 'headlights',
    KeyR: 'reverse', KeyP: 'park', KeyB: 'seatbelt', KeyZ: 'checkLeft', KeyX: 'checkMirror',
    KeyC: 'checkRight', KeyV: 'camera', Escape: 'pause', KeyM: 'mute', KeyN: 'horn',
    Equal: 'zoomIn', Minus: 'zoomOut', NumpadAdd: 'zoomIn', NumpadSubtract: 'zoomOut', Enter: 'confirm', F1: 'help',
  };

  const Input = {
    down: new Set(),
    queue: [],
    init() {
      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'F1'].includes(e.code)) e.preventDefault();
        if (!e.repeat && ACTIONS[e.code]) this.queue.push(ACTIONS[e.code]);
        this.down.add(e.code);
      });
      window.addEventListener('keyup', (e) => this.down.delete(e.code));
      window.addEventListener('blur', () => this.down.clear());
    },
    held(name) { return BINDINGS[name].some((c) => this.down.has(c)); },
    push(action) { this.queue.push(action); },
    drain() { const q = this.queue; this.queue = []; return q; },
  };
  DS.Input = Input;
})();
