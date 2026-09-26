import { SENSORS } from '../../config/fc';
import { omegaMax } from '../flight/FlightMotors';
import { BODY, worldToBody } from '../frames';
import type { Rng } from '../rng';
import { add, cross, dot, len, quatMul, rotate, scale, v3, type Quat, type V3 } from '../vec';
import { Notch, Pt1 } from './filters';

const DEG = Math.PI / 180;
/** Reference speed for the vibration amplitude: ω_max on a full 6S pack. */
const OMEGA_REF = omegaMax(25.2);

export interface MotorSample {
  omega: number;
  imbalance: number;
}

/**
 * Gyro (PRD §3.6): true body rate + white noise + motor-imbalance vibration at each rotor's
 * frequency (sampled at the loop rate, so it aliases like a real 1 kHz gyro) + a slow bias drift;
 * then an RPM notch per motor and a PT1 low-pass. Body axes (three.js), rad/s.
 */
export class Gyro {
  /** Last raw and filtered readings (body axes, rad/s). */
  raw = v3();
  filtered = v3();
  private bias = v3();
  private phase = [0, 0, 0, 0];
  private lpf: Pt1[];
  private notches: Notch[][];

  constructor(
    private rng: Rng,
    private dt: number,
  ) {
    const g = SENSORS.gyro;
    this.lpf = [0, 1, 2].map(() => new Pt1(g.lpfHz, dt));
    this.notches = [0, 1, 2].map(() => [0, 1, 2, 3].map(() => new Notch(dt)));
  }

  reset(): void {
    this.bias = v3();
    this.raw = v3();
    this.filtered = v3();
    for (const f of this.lpf) f.reset();
    for (const axis of this.notches) for (const n of axis) n.reset();
  }

  sample(trueBody: V3, motors: readonly MotorSample[]): V3 {
    const g = SENSORS.gyro;
    const r = this.rng;
    const n = [r.gaussian(), r.gaussian(), r.gaussian(), r.gaussian(), r.gaussian(), r.gaussian()];
    const walk = g.biasWalkDegS * DEG * Math.sqrt(this.dt);
    this.bias = v3(this.bias.x + walk * n[3], this.bias.y + walk * n[4], this.bias.z + walk * n[5]);

    // Each prop's imbalance is a force rotating with it: it rocks the frame about roll and pitch.
    let vib = v3();
    motors.forEach((m, i) => {
      this.phase[i] = (this.phase[i] + m.omega * this.dt) % (2 * Math.PI);
      const a = g.vibrationDegS * DEG * (m.imbalance / 0.01) * (m.omega / OMEGA_REF) ** 2;
      vib = add(vib, v3(a * Math.cos(this.phase[i]), 0, a * Math.sin(this.phase[i])));
    });

    const noise = g.noiseDegS * DEG;
    this.raw = add(add(trueBody, add(vib, this.bias)), v3(noise * n[0], noise * n[1], noise * n[2]));

    const out = [this.raw.x, this.raw.y, this.raw.z].map((x, axis) => {
      let y = x;
      if (g.rpmNotch.enabled) {
        motors.forEach((m, i) => {
          const hz = m.omega / (2 * Math.PI);
          const notch = this.notches[axis][i];
          notch.set(hz >= g.rpmNotch.minHz ? hz : 0, g.rpmNotch.q);
          y = notch.apply(y);
        });
      }
      return this.lpf[axis].apply(y);
    });
    this.filtered = v3(out[0], out[1], out[2]);
    return this.filtered;
  }
}

/** Accelerometer: specific force in body axes (m/s²) + noise, low-passed (used by Angle mode). */
export class Accelerometer {
  filtered = v3(0, 9.81, 0);
  private lpf: Pt1[];

  constructor(
    private rng: Rng,
    dt: number,
  ) {
    this.lpf = [0, 1, 2].map(() => new Pt1(SENSORS.acc.lpfHz, dt));
    this.reset();
  }

  /** Seed the filters with gravity as seen at attitude `q` (level if omitted). */
  reset(q?: Quat, gravity = 9.81): void {
    const g = q ? worldToBody(q, v3(0, gravity, 0)) : v3(0, gravity, 0);
    this.filtered = g;
    this.lpf.forEach((f, i) => f.reset([g.x, g.y, g.z][i]));
  }

  /** @param accelWorld CoM acceleration (world, gravity included) */
  sample(accelWorld: V3, q: Quat, gravity: number): V3 {
    const f = worldToBody(q, add(accelWorld, v3(0, gravity, 0)));
    const s = SENSORS.acc.noise;
    const raw = [f.x + s * this.rng.gaussian(), f.y + s * this.rng.gaussian(), f.z + s * this.rng.gaussian()];
    const out = raw.map((x, i) => this.lpf[i].apply(x));
    this.filtered = v3(out[0], out[1], out[2]);
    return this.filtered;
  }
}

/** Rotation taking unit vector `from` onto unit vector `to`. */
function fromUnitVectors(from: V3, to: V3): Quat {
  const d = dot(from, to);
  if (d < -0.999999) {
    // Opposite: any axis perpendicular to `from`.
    let axis = cross(v3(1, 0, 0), from);
    if (len(axis) < 1e-6) axis = cross(v3(0, 0, 1), from);
    const n = len(axis);
    return { x: axis.x / n, y: axis.y / n, z: axis.z / n, w: 0 };
  }
  const c = cross(from, to);
  const q = { x: c.x, y: c.y, z: c.z, w: 1 + d };
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

/**
 * Attitude estimate for Angle/Horizon and the arming tilt check: a Mahony complementary filter.
 * The gyro integrates attitude; when the accelerometer reads close to 1 g it pulls the estimated
 * up axis toward the measured one and slowly learns the gyro bias.
 */
export class AttitudeEstimator {
  q: Quat = { x: 0, y: 0, z: 0, w: 1 };
  private integral = v3();

  reset(q: Quat): void {
    this.q = { ...q };
    this.integral = v3();
  }

  /** @param armed disarmed, the accelerometer is trusted far more (fast levelling before arming) */
  update(gyroBody: V3, accBody: V3, gravity: number, dt: number, armed = true): Quat {
    const a = SENSORS.attitude;
    let w = gyroBody;
    const an = len(accBody);
    if (an > 1e-6 && Math.abs(an / gravity - 1) < a.accTrustBandG) {
      const measuredUp = scale(accBody, 1 / an);
      const estUp = worldToBody(this.q, v3(0, 1, 0));
      if (!armed && dot(measuredUp, estUp) < Math.cos((a.snapDeg * Math.PI) / 180)) {
        // Far off (the cross product vanishes near 180°): take the accelerometer's attitude.
        this.q = fromUnitVectors(measuredUp, v3(0, 1, 0));
        this.integral = v3();
        return this.q;
      }
      const err = cross(measuredUp, estUp);
      this.integral = add(this.integral, scale(err, a.ki * dt));
      w = add(w, add(scale(err, a.kp * (armed ? 1 : a.disarmedKpScale)), this.integral));
    }
    // q̇ = ½ q ⊗ (0, ω)
    const dq = quatMul(this.q, { x: w.x, y: w.y, z: w.z, w: 0 });
    const q = {
      x: this.q.x + 0.5 * dt * dq.x,
      y: this.q.y + 0.5 * dt * dq.y,
      z: this.q.z + 0.5 * dt * dq.z,
      w: this.q.w + 0.5 * dt * dq.w,
    };
    const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    this.q = { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
    return this.q;
  }

  /** Tilt from level (rad). */
  get tilt(): number {
    const up = rotate(this.q, BODY.up);
    return Math.acos(Math.max(-1, Math.min(1, dot(up, v3(0, 1, 0)))));
  }
}
