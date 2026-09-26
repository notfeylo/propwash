import { AUTOLAND, MODES } from '../../config/fc';
import { attitude } from '../frames';
import type { Quat, V3 } from '../vec';
import type { Sticks } from './FlightController';

export type LandPhase = 'climb' | 'return' | 'descend' | 'touchdown' | 'landed';

export interface AutolandTruth {
  position: V3;
  velocity: V3;
  quaternion: Quat;
  onGround: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Land mode (return to home and land). It outputs virtual sticks for the Angle-mode flight
 * controller: climb to a safe height, fly home facing it, descend fast then slowly, and report
 * `landed` a moment after touchdown so the power logic can disarm.
 */
export class Autoland {
  phase: LandPhase = 'climb';
  /** Learned hover throttle (starts from the airframe's reference). */
  private hover: number;
  private touchT = 0;

  constructor(
    hoverGuess: number,
    private groundAt: (x: number, z: number) => number,
  ) {
    this.hover = hoverGuess;
  }

  reset(hoverGuess: number): void {
    this.phase = 'climb';
    this.hover = hoverGuess;
    this.touchT = 0;
  }

  /** Horizontal distance to home (m). */
  distance(t: AutolandTruth, home: V3): number {
    return Math.hypot(home.x - t.position.x, home.z - t.position.z);
  }

  update(dt: number, t: AutolandTruth, home: V3, g: number): Sticks {
    const A = AUTOLAND;
    const p = t.position;
    const v = t.velocity;
    const dist = this.distance(t, home);
    const ground = this.groundAt(p.x, p.z);
    const cruiseY = Math.max(home.y, ground) + A.cruiseAltM;

    // Phase transitions.
    if (this.phase === 'climb' && (p.y >= cruiseY - 0.5 || dist < A.arriveRadiusM)) this.phase = 'return';
    if (this.phase === 'return' && dist < A.arriveRadiusM && Math.hypot(v.x, v.z) < A.arriveSpeedMs)
      this.phase = 'descend';
    if (this.phase === 'descend' && t.onGround) {
      this.phase = 'touchdown';
      this.touchT = 0;
    }
    if (this.phase === 'touchdown') {
      this.touchT += dt;
      if (this.touchT >= A.disarmAfterS) this.phase = 'landed';
      return { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
    }
    if (this.phase === 'landed') return { throttle: 0, roll: 0, pitch: 0, yaw: 0 };

    // Vertical target speed.
    let vyDes: number;
    if (this.phase === 'descend') vyDes = p.y - ground > A.slowBelowM ? -A.descentFastMs : -A.descentSlowMs;
    else vyDes = clamp(0.8 * (cruiseY - p.y), -A.descentFastMs, 3);

    // Horizontal: hold still while climbing, fly home when returning, hold over home descending.
    const toX = home.x - p.x;
    const toZ = home.z - p.z;
    let vxDes = 0;
    let vzDes = 0;
    if (this.phase !== 'climb') {
      const k = Math.min(A.cruiseSpeedMs, A.posGain * dist) / Math.max(dist, 1e-6);
      vxDes = toX * k;
      vzDes = toZ * k;
    }
    const maxA = g * Math.tan((A.maxTiltDeg * Math.PI) / 180);
    let ax = A.velGain * (vxDes - v.x);
    let az = A.velGain * (vzDes - v.z);
    const an = Math.hypot(ax, az);
    if (an > maxA) {
      ax *= maxA / an;
      az *= maxA / an;
    }

    // World acceleration → Angle-mode stick angles in the drone's heading frame.
    const att = attitude(t.quaternion);
    const fwd = { x: Math.sin(att.yaw), z: -Math.cos(att.yaw) };
    const right = { x: Math.cos(att.yaw), z: Math.sin(att.yaw) };
    const aFwd = ax * fwd.x + az * fwd.z;
    const aRight = ax * right.x + az * right.z;
    const maxAngle = (MODES.angle.maxAngleDeg * Math.PI) / 180;
    const pitch = clamp(Math.atan2(aFwd, g) / maxAngle, -1, 1);
    const roll = clamp(Math.atan2(aRight, g) / maxAngle, -1, 1);

    // Face home on the way back (not in the last metres, where the bearing swings).
    let yaw = 0;
    if (this.phase === 'return' && dist > 3) {
      const bearing = Math.atan2(toX, -toZ);
      yaw = clamp(A.yawGain * wrap(bearing - att.yaw), -0.5, 0.5);
    }

    // Throttle: hover estimate (learned), tilt-compensated, plus climb-rate feedback.
    const err = vyDes - v.y;
    this.hover = clamp(this.hover + A.hoverLearn * err * dt, 0.1, 0.8);
    const tilt = Math.min(0.9, Math.hypot(Math.atan2(aFwd, g), Math.atan2(aRight, g)));
    const throttle = clamp(this.hover / Math.cos(tilt) + A.vzGain * err, 0.05, 0.85);
    return { throttle, roll, pitch, yaw };
  }
}
