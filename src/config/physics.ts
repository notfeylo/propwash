// Flight physics stepping (Phase 2 PRD §1). SI units.

export const PHYSICS = {
  /** Physics + flight controller rate (Hz). */
  rateHz: 1000,
  /** At most this many steps per rendered frame; beyond it the sim runs slow-motion instead of spiralling. */
  maxStepsPerFrame: 8,
  gravity: 9.81,
  /** Default seed for all sim noise (wind gusts, prop wash, sensor noise). */
  seed: 0x5eed,
  /** Contact material for the landing-gear collider and the ground. */
  contact: { friction: 0.8, restitution: 0.05 },
};

/**
 * Drone collider for task group 1: a box over the frame, stack and battery, extended down to the
 * canister when the payload is fitted (model frame, m). Group 3 replaces it with the PRD §5 set
 * (hull, payload capsule, prop discs, motor contact points).
 */
export const FLIGHT_COLLIDER = {
  /** Half width (x) and half length (z) of the frame + stack + battery box (m). */
  halfX: 0.1335,
  halfZ: 0.134,
  /** Top of the battery (model frame y, m). */
  topY: 0.1511,
  /** Lowest point of the canister (model frame y, m). */
  payloadBottomY: -0.0118,
  /** Lowest point of the frame without the canister: the bottom plate (model frame y, m). */
  frameBottomY: 0.052,
};
