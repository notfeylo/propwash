import { type Object3D, Vector2, type Vector3 } from 'three/webgpu';
import { ANTENNA } from '../config/drone';
import { gaussian } from './Vibration';

/**
 * Whip antenna sway: a damped spring on rotation.x/z about the whip base, excited by frame
 * vibration (band-limited noise) and body acceleration.
 */
export class Antenna {
  readonly angle = new Vector2();
  readonly velocity = new Vector2();

  constructor(readonly pivot: Object3D) {}

  update(dt: number, vibrationIntensity: number, bodyAccel: Vector3): void {
    if (dt <= 0) return;
    const { stiffness: k, dampingRatio: zeta, vibrationDrive, accelDrive, maxAngleRad, substepHz } = ANTENNA;
    const c = 2 * zeta * Math.sqrt(k);
    const steps = Math.max(1, Math.ceil(dt * substepHz));
    const h = dt / steps;
    // Noise scaled by 1/√h so the excitation strength doesn't depend on the step size.
    const noise = (vibrationDrive * vibrationIntensity) / Math.sqrt(h * substepHz);
    // Accelerating forward (−Z) tips the whip back (+X rotation); sideways likewise about Z.
    const ax = -bodyAccel.z * accelDrive;
    const az = bodyAccel.x * accelDrive;
    for (let i = 0; i < steps; i++) {
      const fx = -k * this.angle.x - c * this.velocity.x + ax + gaussian() * noise;
      const fz = -k * this.angle.y - c * this.velocity.y + az + gaussian() * noise;
      this.velocity.x += fx * h;
      this.velocity.y += fz * h;
      this.angle.x = Math.max(-maxAngleRad, Math.min(maxAngleRad, this.angle.x + this.velocity.x * h));
      this.angle.y = Math.max(-maxAngleRad, Math.min(maxAngleRad, this.angle.y + this.velocity.y * h));
    }
    this.pivot.rotation.x = this.angle.x;
    this.pivot.rotation.z = this.angle.y;
  }
}
