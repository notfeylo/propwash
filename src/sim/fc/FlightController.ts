import { TURTLE } from '../../config/aero';
import { type Airframe, ROTORS } from '../../config/airframes';
import {
  type AxisGains,
  type FlightMode,
  MODES,
  PID,
  RATES,
  MIXER,
  RC_SMOOTHING,
  type RateParams,
  type RatesModel,
  SENSORS,
} from '../../config/fc';
import { attitude, bodyToFlight, type FlightAxes } from '../frames';
import type { Rng } from '../rng';
import type { Quat, V3 } from '../vec';
import { Pt1, Pt3, pt3CutoffForDelay } from './filters';
import { Mixer } from './mixer';
import { rate } from './rates';
import { Accelerometer, AttitudeEstimator, Gyro, type MotorSample } from './sensors';

const DEG = Math.PI / 180;
type Axis = 'roll' | 'pitch' | 'yaw';
const AXES: Axis[] = ['roll', 'pitch', 'yaw'];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Pilot sticks: throttle 0..1, roll/pitch/yaw −1..1 (roll right, pitch forward, yaw right +). */
export interface Sticks {
  throttle: number;
  roll: number;
  pitch: number;
  yaw: number;
}

/** What the FC gets from the physics each loop (the "truth" its sensors measure). */
export interface FcTruth {
  /** Angular velocity, body axes (rad/s). */
  angularVelocityBody: V3;
  quaternion: Quat;
  /** CoM acceleration (world, m/s², gravity included). */
  accelWorld: V3;
  gravity: number;
  motors: readonly MotorSample[];
  /** Pack voltage the FC measures (V). */
  vLoaded: number;
}

/** Per-loop values, for the blackbox (group 6) and the tests. Rates in deg/s. */
export interface FcTelemetry {
  setpoint: FlightAxes;
  gyro: FlightAxes;
  gyroRaw: FlightAxes;
  p: FlightAxes;
  i: FlightAxes;
  d: FlightAxes;
  f: FlightAxes;
  throttle: number;
  cmd: number[];
  saturated: boolean;
  /** Estimated attitude (rad, flight convention). */
  attitude: FlightAxes;
}

const zero = (): FlightAxes => ({ roll: 0, pitch: 0, yaw: 0 });

/**
 * Betaflight-faithful flight controller (Phase 2 PRD §3), run every physics step (1 kHz):
 * sticks → RC smoothing (PT3) → rates → setpoint → Angle/Horizon outer loop → rate PID (physical
 * units: angular acceleration, then τ = I·α) with I-term relax, anti-windup and TPA → mixer with
 * airmode → motor command. Sensors are modelled (§3.6) unless `idealSensors`.
 */
export class FlightController {
  mode: FlightMode = MODES.default;
  ratesModel: RatesModel = RATES.model;
  rates: Record<Axis, RateParams>;
  gains: Record<Axis, AxisGains>;
  idealSensors = SENSORS.ideal;
  readonly mixer: Mixer;
  readonly gyro: Gyro;
  readonly acc: Accelerometer;
  readonly estimator = new AttitudeEstimator();
  telemetry: FcTelemetry;
  private airframe: Airframe;
  private stickF: Record<keyof Sticks, Pt3>;
  private relaxLpf: Record<Axis, Pt1>;
  private dLpf: Record<Axis, Pt1>;
  private iTerm = zero();
  private prevSp = zero();
  private prevGyroD = zero();
  private saturated = false;
  /** Airmode engages once the throttle first passes MIXER.airmodeStartThrottle after arming. */
  airmodeActive = false;

  constructor(
    airframe: Airframe,
    rng: Rng,
    private dt: number,
  ) {
    this.airframe = airframe;
    this.mixer = new Mixer(airframe);
    this.gyro = new Gyro(rng.fork('gyro'), dt);
    this.acc = new Accelerometer(rng.fork('acc'), dt);
    const d = RATES.defaults[this.ratesModel];
    this.rates = { roll: { ...d }, pitch: { ...d }, yaw: { ...d } };
    this.gains = { roll: { ...PID.roll }, pitch: { ...PID.pitch }, yaw: { ...PID.yaw } };
    const sc = pt3CutoffForDelay(RC_SMOOTHING.delayS);
    this.stickF = { throttle: new Pt3(sc, dt), roll: new Pt3(sc, dt), pitch: new Pt3(sc, dt), yaw: new Pt3(sc, dt) };
    this.relaxLpf = {
      roll: new Pt1(PID.iRelax.cutoffHz, dt),
      pitch: new Pt1(PID.iRelax.cutoffHz, dt),
      yaw: new Pt1(PID.iRelax.cutoffHz, dt),
    };
    this.dLpf = {
      roll: new Pt1(PID.dtermLpfHz, dt),
      pitch: new Pt1(PID.dtermLpfHz, dt),
      yaw: new Pt1(PID.dtermLpfHz, dt),
    };
    this.telemetry = this.emptyTelemetry();
  }

  private emptyTelemetry(): FcTelemetry {
    return {
      setpoint: zero(),
      gyro: zero(),
      gyroRaw: zero(),
      p: zero(),
      i: zero(),
      d: zero(),
      f: zero(),
      throttle: 0,
      cmd: [0, 0, 0, 0],
      saturated: false,
      attitude: zero(),
    };
  }

  setAirframe(a: Airframe): void {
    this.airframe = a;
    this.mixer.setAirframe(a);
  }

  setRatesModel(model: RatesModel): void {
    this.ratesModel = model;
    const d = RATES.defaults[model];
    this.rates = { roll: { ...d }, pitch: { ...d }, yaw: { ...d } };
  }

  /** On arming: clear the integrators and filters; the estimator starts from the resting attitude. */
  reset(q: Quat, sticks?: Sticks): void {
    this.iTerm = zero();
    this.prevSp = zero();
    this.prevGyroD = zero();
    this.saturated = false;
    this.airmodeActive = false;
    this.gyro.reset();
    this.acc.reset(q);
    this.estimator.reset(q);
    for (const k of Object.keys(this.stickF) as (keyof Sticks)[]) this.stickF[k].reset(sticks?.[k] ?? 0);
    for (const a of AXES) {
      this.relaxLpf[a].reset();
      this.dLpf[a].reset();
    }
    this.telemetry = this.emptyTelemetry();
  }

  /** Tilt from level the FC believes (rad): the arming small-angle check uses it. */
  get tilt(): number {
    return this.estimator.tilt;
  }

  /** Keep the sensors and attitude estimate running while disarmed (arming checks read them). */
  sense(t: FcTruth, armed = true): { gyroBody: V3; q: Quat } {
    if (this.idealSensors) {
      this.estimator.reset(t.quaternion);
      return { gyroBody: t.angularVelocityBody, q: t.quaternion };
    }
    const gyroBody = this.gyro.sample(t.angularVelocityBody, t.motors);
    const acc = this.acc.sample(t.accelWorld, t.quaternion, t.gravity);
    const q = this.estimator.update(gyroBody, acc, t.gravity, this.dt, armed);
    return { gyroBody, q };
  }

  /**
   * Turtle mode (flip over after crash, PRD §3.7): upside down on the ground, the stick picks the
   * side to lift and those motors spin in reverse (negative commands). Roll right lifts the right
   * motors, pitch forward the front ones, so the quad rolls over the opposite edge.
   */
  turtle(sticks: Sticks): number[] {
    return ROTORS.map((r) => {
      const side = clamp(Math.sign(r.position[0]) * sticks.roll + -Math.sign(r.position[2]) * sticks.pitch, 0, 1);
      const shaped = side * (1 - TURTLE.expo) + side ** 3 * TURTLE.expo;
      return -shaped * TURTLE.powerFactor;
    });
  }

  /** One control loop: returns the four motor commands (0..1). */
  update(t: FcTruth, raw: Sticks): number[] {
    const dt = this.dt;
    const { gyroBody, q } = this.sense(t);
    const gyro = bodyToFlight(gyroBody);
    const att = attitude(q);

    // RC smoothing: the sticks arrive at the frame rate; PT3 turns their steps into smooth ramps.
    const s: Sticks = {
      throttle: clamp(this.stickF.throttle.apply(raw.throttle), 0, 1),
      roll: this.stickF.roll.apply(raw.roll),
      pitch: this.stickF.pitch.apply(raw.pitch),
      yaw: this.stickF.yaw.apply(raw.yaw),
    };

    const acro: FlightAxes = {
      roll: rate(this.ratesModel, s.roll, this.rates.roll) * DEG,
      pitch: rate(this.ratesModel, s.pitch, this.rates.pitch) * DEG,
      yaw: rate(this.ratesModel, s.yaw, this.rates.yaw) * DEG,
    };
    const sp: FlightAxes = { ...acro };
    if (this.mode !== 'acro') {
      const A = MODES.angle;
      const level = (stick: number, angle: number) => A.kLevel * (stick * A.maxAngleDeg * DEG - angle);
      const angleSp = { roll: level(s.roll, att.roll), pitch: level(s.pitch, att.pitch) };
      if (this.mode === 'angle') {
        sp.roll = angleSp.roll;
        sp.pitch = angleSp.pitch;
      } else {
        // Horizon: self-level at centre stick, fading to acro toward full deflection (flips allowed).
        const w = clamp(Math.max(Math.abs(s.roll), Math.abs(s.pitch)) / MODES.horizon.fullAcroStick, 0, 1);
        sp.roll = angleSp.roll * (1 - w) + acro.roll * w;
        sp.pitch = angleSp.pitch * (1 - w) + acro.pitch * w;
      }
    }

    if (s.throttle > MIXER.airmodeStartThrottle) this.airmodeActive = true;
    // Betaflight: before airmode engages, low throttle means no stabilisation (idle on the pad).
    const stabilising = this.airmodeActive || s.throttle >= MIXER.lowThrottle;
    const tpa = PID.tpa;
    const tpaFactor = 1 - tpa.rate * clamp((s.throttle - tpa.breakpoint) / (1 - tpa.breakpoint), 0, 1);
    const tel = this.telemetry;
    const torque: [number, number, number] = [0, 0, 0];
    const inertia = {
      roll: this.airframe.inertia.roll,
      pitch: this.airframe.inertia.pitch,
      yaw: this.airframe.inertia.yaw,
    };
    AXES.forEach((axis, k) => {
      const g = this.gains[axis];
      const e = sp[axis] - gyro[axis];
      const P = g.kp * e;

      // I-term relax (setpoint-based): a fast-moving setpoint (its high-pass) pauses accumulation.
      let relax = 1;
      if ((PID.iRelax.axes as readonly string[]).includes(axis)) {
        const src = PID.iRelax.type === 'gyro' ? gyro[axis] : sp[axis];
        const hp = src - this.relaxLpf[axis].apply(src);
        relax = Math.max(0, 1 - Math.abs(hp) / (PID.iRelax.thresholdDegS * DEG));
      }
      // Anti-windup: freeze while the mixer is saturated, clamp always.
      if (!this.saturated) this.iTerm[axis] = clamp(this.iTerm[axis] + g.ki * e * relax * dt, -PID.iLimit, PID.iLimit);
      const I = this.iTerm[axis];

      // D on measurement (no setpoint kick), low-passed, attenuated by TPA at high throttle.
      const gd = this.dLpf[axis].apply(gyro[axis]);
      const D = -g.kd * tpaFactor * ((gd - this.prevGyroD[axis]) / dt);
      this.prevGyroD[axis] = gd;

      // Feedforward on the smoothed setpoint's rate of change, faded in above the jitter threshold.
      const dsp = (sp[axis] - this.prevSp[axis]) / dt;
      this.prevSp[axis] = sp[axis];
      const jitter = clamp(Math.abs(dsp) / (RC_SMOOTHING.ffJitterDegS2 * DEG), 0, 1);
      const F = g.ff * dsp * jitter;

      if (!stabilising) this.iTerm[axis] = 0;
      torque[k] = stabilising ? inertia[axis] * (P + I + D + F) : 0;
      tel.p[axis] = P / DEG;
      tel.i[axis] = I / DEG;
      tel.d[axis] = D / DEG;
      tel.f[axis] = F / DEG;
    });

    const mix = this.mixer.mix(s.throttle, torque, t.vLoaded, MIXER.airmode && this.airmodeActive);
    this.saturated = mix.saturated;
    tel.setpoint = { roll: sp.roll / DEG, pitch: sp.pitch / DEG, yaw: sp.yaw / DEG };
    tel.gyro = { roll: gyro.roll / DEG, pitch: gyro.pitch / DEG, yaw: gyro.yaw / DEG };
    const gr = bodyToFlight(this.idealSensors ? t.angularVelocityBody : this.gyro.raw);
    tel.gyroRaw = { roll: gr.roll / DEG, pitch: gr.pitch / DEG, yaw: gr.yaw / DEG };
    tel.throttle = s.throttle;
    tel.cmd = mix.cmd;
    tel.saturated = mix.saturated;
    tel.attitude = att;
    return mix.cmd;
  }
}
