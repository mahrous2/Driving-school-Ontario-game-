/* Player vehicle physics: bicycle model with a friction circle.
 * Weather lowers the tyre-road friction coefficient (mu), which lengthens braking distances
 * and produces understeer / skids when braking hard while turning.
 */
(function () {
  'use strict';
  const DS = window.DS, U = DS.U;

  class PlayerCar {
    constructor(x, y, h) {
      this.id = 'player';
      this.kind = 'player';
      this.x = x; this.y = y; this.h = h;
      this.vx = 0; this.vy = 0;
      this.v = 0; // signed forward speed (m/s)
      this.len = 4.6; this.wid = 1.85; this.L = 2.7;
      this.steerIn = 0; this.steer = 0;
      this.throttle = 0; this.brake = 0;
      this.gear = 'P';
      this.sigL = false; this.sigR = false; this.hazards = false; this.headlights = false; this.seatbelt = false;
      this.sigArmed = false; this.sigOnSince = -1; this.sigH0 = null;
      this.blink = false; this._blinkT = 0;
      this.lastMirror = -99; this.lastShoulderL = -99; this.lastShoulderR = -99;
      this.skidding = false; this.skidTime = 0;
      this.aLong = 0; this.braking = false;
      this.stoppedTime = 0; // continuous time stationary
      this.mu = 1;
      this.odometer = 0;
    }
    get speed() { return Math.abs(this.v); }
    get kmh() { return Math.abs(this.v) * 3.6; }
    signalDir() { if (this.hazards) return 0; return this.sigL ? -1 : this.sigR ? 1 : 0; }
    setSignal(dir, now) {
      if (dir < 0) { this.sigL = !this.sigL; this.sigR = false; } else { this.sigR = !this.sigR; this.sigL = false; }
      this.sigArmed = false;
      this.sigH0 = this.h;
      this.sigOnSince = this.sigL || this.sigR ? now : -1;
    }
    box(pad = 0) { return { x: this.x, y: this.y, h: this.h, hl: this.len / 2 + pad, hw: this.wid / 2 + pad }; }
    front() { return { x: this.x + Math.cos(this.h) * this.len / 2, y: this.y + Math.sin(this.h) * this.len / 2 }; }

    maxSteer(v) {
      // limit steering so lateral demand stays near ~8 m/s² on dry pavement (speed-sensitive steering)
      const a = Math.atan((this.L * 8) / Math.max(v * v, 1));
      return Math.min(0.6, a);
    }

    update(dt, inp, now) {
      const v0 = Math.abs(this.v);
      // ---- controls (progressive pedals for keyboard play) ----
      const steerTarget = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
      const steerRate = steerTarget === 0 ? 3.2 : (Math.sign(steerTarget) !== Math.sign(this.steerIn) && this.steerIn !== 0 ? 4.5 : 2.2);
      this.steerIn = U.approach(this.steerIn, steerTarget, steerRate * dt);
      this.steer = this.steerIn * this.maxSteer(v0);
      this.throttle = inp.throttle ? Math.min(1, this.throttle + dt * 1.6) : Math.max(0, this.throttle - dt * 4);
      this.brake = inp.brake ? Math.min(1, this.brake + dt * (this.brake < 0.35 ? 1.2 : 2.0)) : Math.max(0, this.brake - dt * 5);

      // turn-signal self-cancel: only after the car has actually turned (~45°+) and the wheel returns
      if (this.sigL || this.sigR) {
        const s = this.sigL ? 1 : -1;
        if (this.sigH0 === null) this.sigH0 = this.h;
        if (U.angDiff(this.h, this.sigH0) * s > 0.8) this.sigArmed = true;
        if (this.sigArmed && Math.abs(this.steerIn) < 0.15) { this.sigL = this.sigR = false; this.sigArmed = false; this.sigOnSince = -1; this.sigH0 = null; }
      } else this.sigH0 = null;
      this._blinkT += dt;
      if (this._blinkT > 0.36) { this._blinkT = 0; this.blink = !this.blink; if ((this.sigL || this.sigR || this.hazards) && DS.Audio) DS.Audio.tick(this.blink); }

      const grip = this.mu * U.G;
      const c = Math.cos(this.h), s = Math.sin(this.h);
      let vLong = this.vx * c + this.vy * s;
      let vLat = this.vx * s - this.vy * c; // right-positive

      // ---- longitudinal demand ----
      let aDrive = 0;
      if (this.gear === 'D') aDrive = this.throttle * 3.3 * Math.max(0.25, 1 - Math.max(vLong, 0) / 48);
      else if (this.gear === 'R') aDrive = -this.throttle * 2.2 * (vLong > -4.2 ? 1 : 0);
      const dirSign = Math.abs(vLong) > 0.05 ? Math.sign(vLong) : 0;
      let aBrake = this.brake * 8.5;
      if (this.gear === 'P') aBrake = 9;
      const aResist = dirSign * (0.12 + 0.00042 * vLong * vLong);
      let demand = aDrive - dirSign * aBrake - aResist;
      // brakes can not reverse the car
      if (dirSign === 0 && (Math.abs(aDrive) < 0.01 || aBrake > 2)) { demand = 0; aDrive = 0; vLong = 0; }

      // ---- friction circle ----
      const latKin = vLong * vLong * Math.tan(this.steer) / this.L; // lateral accel the driver asks for
      let aLong = U.clamp(demand, -grip, grip);
      const absActive = Math.abs(demand) > grip * 1.02 && dirSign !== 0 && aBrake > 0.5;
      if (absActive) aLong = -dirSign * grip * 0.9; // ABS keeps some steering ability
      const latAvail = Math.sqrt(Math.max(0, grip * grip - aLong * aLong)) + (absActive ? grip * 0.35 : 0);
      let yawScale = 1;
      if (Math.abs(latKin) > latAvail && v0 > 2) yawScale = latAvail / Math.abs(latKin);
      const skid = (yawScale < 0.85 || (absActive && this.mu < 0.6 && v0 > 5));
      this.skidding = skid;
      this.skidTime = skid ? this.skidTime + dt : 0;

      // ---- integrate ----
      // When grip is exceeded the body rotates a little more than the tyres can follow -> visible slide
      const yawRate = (vLong * Math.tan(this.steer) / this.L) * (yawScale < 1 ? Math.min(1, yawScale * 1.5) : 1);
      this.h = U.angNorm(this.h + yawRate * dt);
      // world velocity is kept; re-express it in the rotated body frame
      const c2 = Math.cos(this.h), s2 = Math.sin(this.h);
      vLong = this.vx * c2 + this.vy * s2;
      vLat = this.vx * s2 - this.vy * c2;
      if (dirSign === 0 && Math.abs(aDrive) < 0.01) vLong = 0;
      const prevSign = Math.sign(vLong);
      vLong += aLong * dt;
      if (dirSign !== 0 && Math.sign(vLong) !== prevSign && Math.abs(aDrive) < 0.01) vLong = 0;
      if (this.gear === 'P' && Math.abs(vLong) < 0.3) vLong = 0;
      // lateral slip is removed by the tyres, limited by the remaining grip (slow on ice)
      const latCorr = latAvail * dt;
      vLat = Math.abs(vLat) <= latCorr ? 0 : vLat - Math.sign(vLat) * latCorr;
      if (v0 < 1.5) vLat *= 0.8;
      this.vx = vLong * c2 + vLat * s2;
      this.vy = vLong * s2 - vLat * c2;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.v = vLong;
      this.aLong = aLong;
      this.braking = this.brake > 0.05 || (this.gear === 'P');
      this.stoppedTime = Math.abs(this.v) < 0.12 ? this.stoppedTime + dt : 0;
      this.odometer += Math.abs(vLong) * dt;
    }
    stopDead() { this.vx = this.vy = 0; this.v = 0; this.throttle = 0; }
    // stopping distance (reaction 1.5 s + braking at 85% of available grip)
    stoppingDistance() { const v = Math.abs(this.v); return v * 1.5 + (v * v) / (2 * this.mu * U.G * 0.85); }
  }
  DS.PlayerCar = PlayerCar;
})();
