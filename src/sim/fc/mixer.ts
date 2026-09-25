import { type Airframe, MOTOR_PROP, ROTORS } from '../../config/airframes';
import { MIXER } from '../../config/fc';
import { cmdForOmega, omegaCmd, omegaMax } from '../flight/FlightMotors';
import { bodyToFlight } from '../frames';
import { cross, sub, v3 } from '../vec';

/** Inverse of a small dense square matrix (Gauss–Jordan with partial pivoting). */
export function invert(m: number[][]): number[][] {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) throw new Error('mixer: singular allocation matrix');
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row) => row.slice(n));
}

export interface MixResult {
  cmd: number[];
  /** The request didn't fit: airmode shifted the collective or scaled the differential. */
  saturated: boolean;
}

/**
 * Mixer (PRD §3.5). The allocation matrix maps per-motor thrust to [T_total, τ_roll, τ_pitch,
 * τ_yaw] (flight axes) from geometry (τ = r × T about the CoM) and spin (yaw = s·kQ/kT·T); its
 * inverse turns a request into per-motor thrust, then speed, then command.
 *
 * Airmode: when a motor would leave [idle, max], the collective shifts to keep the differential;
 * if the differential itself is wider than the range, yaw is scaled down first, then roll/pitch.
 */
export class Mixer {
  private inv: number[][] = [];
  /** Allocation matrix (rows: thrust, roll, pitch, yaw; columns: M1..M4). */
  alloc: number[][] = [];

  constructor(airframe: Airframe) {
    this.setAirframe(airframe);
  }

  setAirframe(a: Airframe): void {
    const m = MOTOR_PROP;
    const com = v3(...a.com);
    const cols = ROTORS.map((r) => {
      const arm = sub(v3(...r.position), com);
      // Torque per newton of thrust along body up, in flight axes.
      const t = bodyToFlight(cross(arm, v3(0, 1, 0)));
      // Reaction torque on the body is −s·Q about body up; per newton of thrust, −s·kQ/kT.
      const yaw = bodyToFlight(v3(0, (-r.spin * m.kQ) / m.kT, 0)).yaw;
      return [1, t.roll, t.pitch, yaw];
    });
    this.alloc = [0, 1, 2, 3].map((row) => cols.map((c) => c[row]));
    this.inv = invert(this.alloc);
  }

  /** Per-motor thrust (N) for [T_total, roll, pitch, yaw] (N, N·m in flight axes). */
  allocate(w: readonly number[]): number[] {
    return this.inv.map((row) => row.reduce((s, k, j) => s + k * w[j], 0));
  }

  /**
   * @param throttle collective stick 0..1 (motor command, like Betaflight's throttle)
   * @param torque requested [roll, pitch, yaw] torque (N·m, flight axes)
   * @param vLoaded pack voltage the FC measures (sets the thrust range)
   */
  mix(
    throttle: number,
    torque: readonly [number, number, number],
    vLoaded: number,
    airmode = MIXER.airmode,
  ): MixResult {
    const m = MOTOR_PROP;
    const fIdle = m.kT * m.idleRads ** 2;
    const fMax = m.kT * omegaMax(vLoaded) ** 2;
    const range = fMax - fIdle;
    const f0 = m.kT * omegaCmd(throttle, vLoaded) ** 2;

    const rp = this.allocate([0, torque[0], torque[1], 0]);
    const yw = this.allocate([0, 0, 0, torque[2]]);
    const spread = (d: number[]) => Math.max(...d) - Math.min(...d);
    let saturated = false;
    let diff = rp.map((x, i) => x + yw[i]);
    if (spread(diff) > range) {
      saturated = true;
      if (spread(rp) >= range) {
        const k = range / spread(rp);
        diff = rp.map((x) => x * k);
      } else {
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 20; i++) {
          const mid = (lo + hi) / 2;
          if (spread(rp.map((x, j) => x + mid * yw[j])) <= range) lo = mid;
          else hi = mid;
        }
        diff = rp.map((x, j) => x + lo * yw[j]);
      }
    }
    let base = f0;
    const lo = fIdle - Math.min(...diff);
    const hi = fMax - Math.max(...diff);
    if (airmode) {
      if (base < lo || base > hi) saturated = true;
      base = Math.min(Math.max(base, lo), hi);
    } else if (base > hi) {
      saturated = true;
      base = hi;
    }
    const cmd = diff.map((d) => {
      const f = Math.max(0, base + d);
      const c = cmdForOmega(Math.sqrt(f / m.kT), vLoaded);
      return Math.min(1, Math.max(0, c));
    });
    return { cmd, saturated };
  }
}
