import { MOTOR_PROP, ROTORS } from '../../config/airframes';
import { ARMING } from '../../config/motor';
import type { Rng } from '../rng';

export type MotorDrive = 'driven' | 'coast';

const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** ω_max(V) = loadedFraction · KV · V · 2π/60 (rad/s), PRD §2.2. */
export const omegaMax = (vLoaded: number, m = MOTOR_PROP) => (m.loadedFraction * m.kv * vLoaded * 2 * Math.PI) / 60;

/** Commanded speed for a 0..1 motor command: ω_idle + (ω_max − ω_idle)·cmd. */
export const omegaCmd = (cmd: number, vLoaded: number, m = MOTOR_PROP) =>
  m.idleRads + (omegaMax(vLoaded, m) - m.idleRads) * Math.min(1, Math.max(0, cmd));

/** Inverse of omegaCmd: the command that asks for ω at this voltage. */
export const cmdForOmega = (omega: number, vLoaded: number, m = MOTOR_PROP) =>
  (omega - m.idleRads) / (omegaMax(vLoaded, m) - m.idleRads);

/** Ground effect: GE(h) = 1/(1 − (R/4h)²) for h > R/2, clamped (PRD §2.2). */
export function groundEffect(h: number, m = MOTOR_PROP): number {
  if (h <= m.propRadiusM / 2) return m.groundEffectMax;
  const k = m.propRadiusM / (4 * h);
  return Math.min(m.groundEffectMax, 1 / (1 - k * k));
}

/**
 * Thrust (N) at speed ω with axial inflow v_in (m/s, positive when climbing into the disc) and
 * rotor height h above the ground: T = kT·ω²·clamp(1 − v_in/(K_eff·v_pitch), 0, 1.2)·GE(h).
 */
export function thrust(omega: number, vIn: number, h: number, m = MOTOR_PROP): number {
  if (omega <= 0) return 0;
  const vPitch = (omega / (2 * Math.PI)) * m.pitchM;
  const inflow = Math.min(m.inflowFactorMax, Math.max(0, 1 - vIn / (m.kEff * vPitch)));
  return m.kT * omega * omega * inflow * groundEffect(h, m);
}

export interface MotorState {
  /** Rotor speed (rad/s, ≥ 0; reverse spin arrives with turtle mode). */
  omega: number;
  /** dω/dt over the last step (rad/s²), for the rotor-inertia yaw kick and the audio transients. */
  domega: number;
  /** Spin seen from above: +1 CCW, −1 CW. */
  spin: number;
  /** Fixed imbalance fraction (vibration into the gyro model and the FPV shake). */
  imbalance: number;
}

/**
 * The four ESC + motor + prop units (PRD §2.2): first-order speed dynamics with separate up and
 * down time constants (DShot active braking), linear command → speed map scaled by the loaded
 * pack voltage, the Phase 1 arming ramp (stagger, soft-arm) and a free coast when unpowered.
 */
export class FlightMotors {
  readonly motors: MotorState[];
  drive: MotorDrive = 'coast';
  private ramp: { delay: number; t: number; len: number }[];

  constructor(
    rng: Rng,
    readonly m = MOTOR_PROP,
  ) {
    const [lo, hi] = m.imbalance;
    this.motors = ROTORS.map((r) => ({ omega: 0, domega: 0, spin: r.spin, imbalance: lo + rng.uniform() * (hi - lo) }));
    this.ramp = ROTORS.map(() => ({ delay: 0, t: Infinity, len: 0 }));
  }

  get rpms(): number[] {
    return this.motors.map((s) => (s.omega * 60) / (2 * Math.PI));
  }

  /** Arm: every motor ramps to idle after its own 0–40 ms stagger (Phase 1 behaviour). */
  arm(rng: Rng, soft = ARMING.softArm): void {
    const len = soft ? ARMING.softIdleRampS : ARMING.idleRampS;
    for (const r of this.ramp) Object.assign(r, { delay: rng.uniform() * ARMING.staggerS, t: 0, len });
    this.drive = 'driven';
  }

  /**
   * Advance one fixed step.
   * @param cmds per-motor command 0..1
   * @param vLoaded pack voltage under load (V)
   * @param stopAtZero motor test: a 0 command stops the motor instead of idling
   */
  step(h: number, cmds: readonly number[], vLoaded: number, stopAtZero = false): void {
    const m = this.m;
    this.motors.forEach((s, i) => {
      const prev = s.omega;
      if (this.drive === 'driven' && vLoaded > 0) {
        let goal = stopAtZero && cmds[i] <= 0 ? 0 : omegaCmd(cmds[i] ?? 0, vLoaded, m);
        const r = this.ramp[i];
        if (r.t < r.delay + r.len) {
          r.t += h;
          // Never pull a still-coasting prop down to the ramp.
          goal = Math.max(s.omega, goal * smoothstep((r.t - r.delay) / r.len));
        }
        const tau = goal > s.omega ? m.tauUpS : m.tauDownS;
        s.omega = goal + (s.omega - goal) * Math.exp(-h / tau);
      } else {
        s.omega *= Math.exp(-h / m.tauCoastS);
        if (s.omega < m.stopRads) s.omega = 0;
      }
      s.domega = (s.omega - prev) / h;
    });
  }
}
