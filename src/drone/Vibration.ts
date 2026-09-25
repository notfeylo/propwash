import { Euler, Vector3 } from 'three/webgpu';
import { DRONE, VIBRATION } from '../config/drone';
import type { Rotor } from './Rotor';

export const gaussian = (rand: () => number = Math.random) =>
  Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

/**
 * Body micro-jitter from rotor imbalance: each motor shakes the frame at its own rotation
 * rate with a drifting phase, scaled by (rpm/rpmMax)². At real motor rates (hundreds of Hz)
 * the per-frame samples read as fine, non-periodic shake.
 */
export class Vibration {
  readonly position = new Vector3();
  readonly rotation = new Euler();
  /** Mean (rpm/rpmMax)² across motors, 0..1. */
  intensity = 0;
  private phases: number[];

  constructor(motors: number, rand: () => number = Math.random) {
    this.phases = Array.from({ length: motors }, () => rand() * Math.PI * 2);
  }

  update(dt: number, rotors: readonly Rotor[]): void {
    let px = 0;
    let py = 0;
    let pz = 0;
    let rx = 0;
    let ry = 0;
    let rz = 0;
    let total = 0;
    rotors.forEach((r, i) => {
      this.phases[i] += gaussian() * VIBRATION.phaseNoise * Math.sqrt(dt);
      const s = (r.rpm / DRONE.rpmMax) ** 2;
      const a = r.angle + this.phases[i];
      total += s;
      px += s * Math.sin(a);
      pz += s * Math.cos(a);
      py += s * Math.sin(2 * a + i);
      rx += s * Math.cos(a + 1.3 * i);
      ry += s * Math.sin(a + 0.7 * i) * 0.5;
      rz += s * Math.sin(a + 2.1 * i);
    });
    const n = rotors.length || 1;
    this.intensity = total / n;
    const P = VIBRATION.positionM / n;
    const R = VIBRATION.rotationRad / n;
    this.position.set(px * P, py * P, pz * P);
    this.rotation.set(rx * R, ry * R, rz * R);
  }
}
