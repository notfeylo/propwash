import { rotate, rotateInv, type Quat, type V3, v3 } from './vec';

/**
 * The only place axis conventions are converted (Phase 2 PRD §1). Never flip signs elsewhere.
 *
 * World and body frames follow three.js: Y up, nose along −Z, right along +X. Rotations are
 * right-handed about those axes.
 *
 * Flight axes follow the pilot's sticks, which is how Betaflight's setpoints read:
 *   roll  +  = right wing down   (rotation about the nose axis −Z)  ⇒ roll  = −ω_z
 *   pitch +  = nose down         (stick forward)                    ⇒ pitch = −ω_x
 *   yaw   +  = nose right        (seen from above, clockwise)       ⇒ yaw   = −ω_y
 * Blackbox export maps these to Betaflight's gyro sign convention in one function (task group 6).
 */
export interface FlightAxes {
  roll: number;
  pitch: number;
  yaw: number;
}

/** Body-frame angular velocity (rad/s, three.js axes) → flight rates (rad/s). */
export function bodyToFlight(w: V3): FlightAxes {
  return { roll: -w.z, pitch: -w.x, yaw: -w.y };
}

/** Flight-axis vector (roll, pitch, yaw) → body-frame vector (three.js axes). */
export function flightToBody(f: FlightAxes): V3 {
  return v3(-f.pitch, -f.yaw, -f.roll);
}

/** Body axes in body coordinates. */
export const BODY = {
  right: v3(1, 0, 0),
  up: v3(0, 1, 0),
  nose: v3(0, 0, -1),
};

export const bodyToWorld = (q: Quat, v: V3): V3 => rotate(q, v);
export const worldToBody = (q: Quat, v: V3): V3 => rotateInv(q, v);

/** Tilt from upright (rad): angle between body up and world up. */
export function tiltAngle(q: Quat): number {
  const up = rotate(q, BODY.up);
  return Math.acos(Math.max(-1, Math.min(1, up.y)));
}

/**
 * Euler attitude in flight terms (rad): roll right-wing-down positive, pitch nose-down positive,
 * heading clockwise from −Z. Intrinsic yaw → pitch → roll.
 */
export function attitude(q: Quat): FlightAxes {
  const nose = rotate(q, BODY.nose);
  const right = rotate(q, BODY.right);
  const yaw = Math.atan2(nose.x, -nose.z);
  const pitch = -Math.asin(Math.max(-1, Math.min(1, nose.y)));
  const c = Math.cos(pitch);
  const roll = c > 1e-9 ? -Math.asin(Math.max(-1, Math.min(1, right.y / c))) : 0;
  return { roll, pitch, yaw };
}
