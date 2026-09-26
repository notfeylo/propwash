import { AIR, PROP_WASH } from '../../config/aero';
import { MOTOR_PROP, ROTORS } from '../../config/airframes';
import { BandPass, Pt1 } from '../fc/filters';
import { Rng } from '../rng';

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Induced velocity of a rotor making `thrust` N: √(T / 2ρA) (m/s). */
export const inducedVelocity = (thrust: number) =>
  Math.sqrt(Math.max(thrust, PROP_WASH.minThrustN) / (2 * AIR.rho * Math.PI * MOTOR_PROP.propRadiusM ** 2));

/**
 * Prop wash / vortex ring (Phase 2 PRD §2.4), the 7″ signature. A rotor descending into its own
 * wake (axial inflow below −onset × v_induced) with little horizontal speed loses some thrust and
 * gets band-limited (10–40 Hz) random thrust fluctuations; with four rotors those are random roll,
 * pitch and lift disturbances the rate PID fights, which is the familiar wobble on hard descents.
 */
export class PropWash {
  /** Per-rotor severity 0..1 (smoothed). */
  readonly severity: number[];
  private noise: BandPass[];
  private smoothers: Pt1[];
  private readonly gain: number;

  constructor(
    private rng: Rng,
    dt: number,
  ) {
    const [lo, hi] = PROP_WASH.bandHz;
    this.noise = ROTORS.map(() => new BandPass(lo, hi, dt));
    this.smoothers = ROTORS.map(() => new Pt1(PROP_WASH.severityLpfHz, dt));
    this.severity = ROTORS.map(() => 0);
    // Normalize the band-passed noise to unit RMS (measured once, with its own fixed seed).
    const probe = new BandPass(lo, hi, dt);
    const r = new Rng(0x9a5b);
    let sum = 0;
    const n = 40000;
    for (let i = 0; i < n; i++) {
      const y = probe.apply(r.gaussian());
      if (i > 2000) sum += y * y;
    }
    this.gain = 1 / Math.sqrt(sum / (n - 2000));
  }

  get maxSeverity(): number {
    return Math.max(...this.severity);
  }

  /**
   * Thrust multiplier for rotor `i` this step.
   * @param vIn axial inflow (m/s, positive climbing into the disc)
   * @param thrust the rotor's thrust before wash (N)
   * @param vPlane airspeed in the rotor plane (m/s)
   */
  multiplier(i: number, vIn: number, thrust: number, vPlane: number): number {
    const W = PROP_WASH;
    const vi = inducedVelocity(Math.abs(thrust));
    const axial = smooth((-vIn - W.onsetInducedFraction * vi) / (W.fullInducedFraction * vi));
    const fade = 1 - smooth((vPlane - W.fadeHorizontalMs * 0.5) / W.fadeHorizontalMs);
    const sev = this.smoothers[i].apply(axial * fade);
    this.severity[i] = sev;
    // Draw every step so the random stream never depends on the flight path.
    const n = this.noise[i].apply(this.rng.gaussian()) * this.gain;
    return Math.max(0, 1 - W.thrustLoss * sev + W.fluctuation * sev * n);
  }
}
