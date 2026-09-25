import { ARMING, MOTOR } from '../config/motor';

export type MotorDrive = 'driven' | 'coast';

/** Seeded PRNG so each motor's personality (offset, noise) is stable and testable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** RPM the throttle asks for (PRD §4.4), before per-motor variance. */
export function targetRpm(throttle: number, vbat: number, cfg = MOTOR): number {
  const loadedMax = cfg.loadedFraction * cfg.kv * vbat;
  const t = Math.min(1, Math.max(0, throttle));
  return cfg.rpmIdle + (loadedMax - cfg.rpmIdle) * t ** cfg.curveExponent;
}

/** One motor: lagged RPM with a slight overshoot, slow noise, a fixed offset, coast when unpowered. */
export class Motor {
  /** Output RPM (what the prop and audio see). */
  rpm = 0;
  /** Rate of change of `rpm` (RPM/s), for the audio transient layer. */
  rpmRate = 0;
  drive: MotorDrive = 'coast';
  private vel = 0;
  private readonly offset: number;
  private readonly noise: { hz: number; phase: number }[];
  private rampDelay = 0;
  private rampS = 0;
  private rampT = Infinity;

  constructor(
    readonly index: number,
    rand: () => number = mulberry32(1000 + index),
  ) {
    const v = MOTOR.variance;
    this.offset = (rand() * 2 - 1) * v.offsetFraction;
    this.noise = Array.from({ length: 3 }, () => ({
      hz: v.noiseHz[0] + rand() * (v.noiseHz[1] - v.noiseHz[0]),
      phase: rand() * Math.PI * 2,
    }));
  }

  /** Multiplicative variance at time t: fixed offset + band-limited 3–8 Hz noise. */
  variance(t: number): number {
    const n = this.noise.reduce((s, c) => s + Math.sin(2 * Math.PI * c.hz * t + c.phase), 0) / this.noise.length;
    return 1 + this.offset + n * MOTOR.variance.noiseFraction;
  }

  /** Begin the arm ramp to idle after `delay` seconds, taking `rampS`. */
  startIdleRamp(delay: number, rampS: number): void {
    this.rampDelay = delay;
    this.rampS = rampS;
    this.rampT = 0;
  }

  /** @param target commanded RPM (before variance); ignored while coasting. */
  step(h: number, t: number, target: number): void {
    const prev = this.rpm;
    if (this.drive === 'driven') {
      let goal = target * this.variance(t);
      if (this.rampT < this.rampDelay + this.rampS) {
        this.rampT += h;
        // Never pull a still-coasting prop down to the ramp.
        goal = Math.max(this.rpm, goal * smoothstep((this.rampT - this.rampDelay) / this.rampS));
      }
      const tau = goal > this.rpm ? MOTOR.tauUp : MOTOR.tauDown;
      const w = MOTOR.overshoot.riseFactor / tau;
      const z = MOTOR.overshoot.dampingRatio;
      this.vel += (w * w * (goal - this.rpm) - 2 * z * w * this.vel) * h;
      this.rpm = Math.max(0, this.rpm + this.vel * h);
    } else {
      // Unpowered: free exponential coast (no ringing), with a clean stop.
      this.rpm *= Math.exp(-h / MOTOR.tauCoast);
      this.vel = -this.rpm / MOTOR.tauCoast;
      if (this.rpm < MOTOR.stopRpm) this.rpm = this.vel = 0;
    }
    this.rpmRate = (this.rpm - prev) / h;
  }
}

/** The four motors, integrated at a fixed substep. */
export class MotorModel {
  readonly motors: Motor[];
  time = 0;
  private acc = 0;

  constructor(count = MOTOR.motorCount, seed = 1000) {
    this.motors = Array.from({ length: count }, (_, i) => new Motor(i, mulberry32(seed + i)));
  }

  get rpms(): number[] {
    return this.motors.map((m) => m.rpm);
  }

  setDrive(drive: MotorDrive): void {
    for (const m of this.motors) m.drive = drive;
  }

  /** Arm: every motor ramps to idle, each after a random 0–40 ms stagger. */
  arm(rand: () => number = Math.random, soft = ARMING.softArm): void {
    const ramp = soft ? ARMING.softIdleRampS : ARMING.idleRampS;
    for (const m of this.motors) m.startIdleRamp(rand() * ARMING.staggerS, ramp);
    this.setDrive('driven');
  }

  /** @param targets commanded RPM per motor (length = motors). */
  update(dt: number, targets: readonly number[]): void {
    const h = 1 / MOTOR.substepHz;
    this.acc += dt;
    let rates = this.motors.map(() => 0);
    let n = 0;
    while (this.acc >= h) {
      this.acc -= h;
      this.time += h;
      this.motors.forEach((m, i) => {
        m.step(h, this.time, targets[i] ?? 0);
        rates[i] += m.rpmRate;
      });
      n++;
    }
    if (n) {
      rates = rates.map((r) => r / n);
      this.motors.forEach((m, i) => (m.rpmRate = rates[i]));
    }
  }
}
