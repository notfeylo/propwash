import { AIR, BODY_AERO, WIND, type WindPreset } from '../../config/aero';
import type { Airframe } from '../../config/airframes';
import type { Rng } from '../rng';
import { dot, len, scale, v3, type V3 } from '../vec';

/**
 * Wind (PRD §2.3): a constant vector plus Dryden-lite gusts, each axis a first-order Gauss–Markov
 * process with standard deviation σ and correlation time L / max(airspeed, minSpeed).
 */
export class Wind {
  preset: WindPreset;
  private gust = v3();

  constructor(
    private rng: Rng,
    preset: WindPreset = WIND.default,
  ) {
    this.preset = preset;
  }

  get mean(): V3 {
    const m = WIND.presets[this.preset].meanMs;
    return v3(Math.sin(WIND.headingRad) * m, 0, -Math.cos(WIND.headingRad) * m);
  }

  /** Current wind velocity (world, m/s). */
  get velocity(): V3 {
    const m = this.mean;
    return v3(m.x + this.gust.x, m.y + this.gust.y, m.z + this.gust.z);
  }

  /** @param airspeed the drone's speed relative to the air (m/s), sets the gust correlation time */
  step(h: number, airspeed: number): void {
    const sigma = WIND.presets[this.preset].sigmaMs;
    // Always draw, so the random stream (and replays) don't depend on the preset.
    const n = [this.rng.gaussian(), this.rng.gaussian(), this.rng.gaussian()];
    if (sigma <= 0) {
      this.gust = v3();
      return;
    }
    const speed = Math.max(airspeed, len(this.mean), WIND.minSpeedMs);
    const L = WIND.lengthScaleM;
    const axis = (g: number, s: number, lengthM: number, noise: number) => {
      const tau = lengthM / speed;
      const a = Math.exp(-h / tau);
      return g * a + s * Math.sqrt(1 - a * a) * noise;
    };
    this.gust = v3(
      axis(this.gust.x, sigma, L.horizontal, n[0]),
      axis(this.gust.y, sigma * WIND.verticalSigmaFactor, L.vertical, n[1]),
      axis(this.gust.z, sigma, L.horizontal, n[2]),
    );
  }
}

/**
 * Body drag (PRD §2.3): F = −½ρ·CdA(attitude)·|v_air|·v_air, where CdA blends the top area (flow
 * along the body up axis) and the front area (flow in the body's horizontal plane) by cos²/sin².
 * @param vAir drone velocity relative to the air (world)
 * @param upWorld body up axis (world)
 */
export function bodyDrag(a: Airframe, vAir: V3, upWorld: V3): V3 {
  const speed = len(vAir);
  if (speed < 1e-9) return v3();
  const c = dot(vAir, upWorld) / speed;
  const cdA = a.cdA.top * c * c + a.cdA.front * (1 - c * c);
  return scale(vAir, -0.5 * AIR.rho * cdA * speed);
}

/** Angular damping: τ = −cω·ω (world or body, same frame in and out). */
export const angularDamping = (w: V3): V3 => scale(w, -BODY_AERO.angularDamping);
