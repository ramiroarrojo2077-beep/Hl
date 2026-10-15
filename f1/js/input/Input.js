// Entradas: teclado, mando (Gamepad API), volante (ejes configurables con calibración)
// y controles táctiles. Devuelve un estado unificado por cuadro.

export const DEFAULT_KEYS = {
  throttle: ['ArrowUp', 'KeyW'], brake: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  gearUp: ['KeyE', 'ShiftLeft'], gearDown: ['KeyQ', 'ControlLeft'], drs: ['Space', 'KeyF'], limiter: ['KeyL'],
  camera: ['KeyC'], lookBack: ['KeyV'], box: ['KeyB'], mfd: ['KeyM', 'Tab'], ers: ['KeyX'], reset: ['KeyR'], pause: ['Escape', 'KeyP'],
};

export class Input {
  constructor(settings) {
    this.settings = settings;
    this.keys = new Set();
    this.pressed = new Set();
    this.steerKb = 0;
    this.state = { steer: 0, throttle: 0, brake: 0, gearUp: false, gearDown: false, drs: false, steerMode: 'keyboard' };
    this.padPrev = [];
    this.touch = { left: false, right: false, gas: false, brake: false, drs: false };
    window.addEventListener('keydown', e => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.calib = null;
  }

  get map() { return { ...DEFAULT_KEYS, ...(this.settings.keys || {}) }; }

  down(action) { return this.map[action].some(k => this.keys.has(k)); }
  hit(action) { return this.map[action].some(k => this.pressed.has(k)); }

  gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  // Detecta el eje del volante/pedal que más se mueve (calibración)
  startCalibration(which) {
    const pad = this.gamepad();
    if (!pad) return false;
    this.calib = { which, base: pad.axes.slice(), best: -1, amount: 0 };
    return true;
  }

  pollCalibration() {
    if (!this.calib) return null;
    const pad = this.gamepad();
    if (!pad) return null;
    pad.axes.forEach((v, i) => {
      const d = Math.abs(v - this.calib.base[i]);
      if (d > this.calib.amount) { this.calib.amount = d; this.calib.best = i; this.calib.dir = Math.sign(v - this.calib.base[i]); }
    });
    if (this.calib.amount > 0.5) {
      const r = { which: this.calib.which, axis: this.calib.best, invert: this.calib.which !== 'steer' && this.calib.dir < 0, rest: this.calib.base[this.calib.best] };
      this.calib = null;
      return r;
    }
    return null;
  }

  update(dt) {
    const st = this.state, set = this.settings;
    const btn = {};
    // teclado
    const kL = this.down('left') || this.touch.left, kR = this.down('right') || this.touch.right;
    const target = (kR ? 1 : 0) - (kL ? 1 : 0);
    const sens = set.steerSens ?? 1;
    const rate = target === 0 ? 5 : (Math.sign(target) !== Math.sign(this.steerKb) ? 7 : 3.2) * sens;
    this.steerKb += Math.max(-rate * dt, Math.min(rate * dt, target - this.steerKb));
    let steer = this.steerKb, throttle = (this.down('throttle') || this.touch.gas) ? 1 : 0, brake = (this.down('brake') || this.touch.brake) ? 1 : 0;
    let mode = 'keyboard';
    for (const a of ['gearUp', 'gearDown', 'drs', 'limiter', 'camera', 'lookBack', 'box', 'mfd', 'ers', 'reset', 'pause']) btn[a] = this.hit(a);
    btn.drsHold = this.down('drs') || this.touch.drs;
    btn.lookBackHold = this.down('lookBack');
    // mando / volante
    const pad = this.gamepad();
    if (pad) {
      const dz = (v, z = 0.08) => (Math.abs(v) < z ? 0 : (v - Math.sign(v) * z) / (1 - z));
      const prev = this.padPrev;
      const b = i => pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5);
      const edge = i => b(i) && !prev[i];
      const dev = set.device || 'auto';
      if (dev === 'wheel' && set.wheel) {
        const w = set.wheel;
        const ax = (cfg) => {
          if (!cfg || cfg.axis === undefined || cfg.axis < 0) return 0;
          let v = pad.axes[cfg.axis] ?? 0;
          if (cfg.invert) v = -v;
          return v;
        };
        const sv = ax(w.steer);
        if (Math.abs(sv) > 0.01 || w.steer) { steer = Math.max(-1, Math.min(1, sv * (w.steerGain || 1))); mode = 'wheel'; }
        const thr = (ax(w.throttle) + 1) / 2, brk = (ax(w.brake) + 1) / 2;
        if (w.throttle) throttle = Math.max(throttle, Math.max(0, Math.min(1, thr)));
        if (w.brake) brake = Math.max(brake, Math.max(0, Math.min(1, brk)));
      } else {
        const sx = dz(pad.axes[0] || 0);
        if (Math.abs(sx) > 0) { steer = Math.sign(sx) * Math.pow(Math.abs(sx), set.padCurve ?? 1.6); mode = 'pad'; }
        const rt = pad.buttons[7] ? pad.buttons[7].value : 0, lt = pad.buttons[6] ? pad.buttons[6].value : 0;
        if (rt > 0.02) { throttle = Math.max(throttle, rt); mode = mode === 'keyboard' ? 'pad' : mode; }
        if (lt > 0.02) brake = Math.max(brake, lt);
      }
      if (edge(5)) btn.gearUp = true;
      if (edge(4)) btn.gearDown = true;
      if (edge(0)) btn.drs = true;
      if (b(0)) btn.drsHold = true;
      if (edge(2)) btn.limiter = true;
      if (edge(3)) btn.camera = true;
      if (b(1)) btn.lookBackHold = true;
      if (edge(9)) btn.pause = true;
      if (edge(8)) btn.mfd = true;
      if (edge(12)) btn.box = true;
      if (edge(13)) btn.ers = true;
      if (edge(14)) btn.reset = true;
      this.padPrev = pad.buttons.map((_, i) => b(i));
      this.pad = pad;
    } else this.pad = null;
    st.steer = steer; st.throttle = throttle; st.brake = brake; st.steerMode = mode;
    Object.assign(st, btn);
    st.gearUp = btn.gearUp; st.gearDown = btn.gearDown;
    st.drs = btn.drsHold;
    st.lookBack = btn.lookBackHold;
    this.pressed.clear();
    return st;
  }

  rumble(strong, weak, ms = 80) {
    const p = this.pad;
    if (!p || this.settings.vibration === false || !p.vibrationActuator) return;
    try { p.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch { /* sin soporte */ }
  }
}
