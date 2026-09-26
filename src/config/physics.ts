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

/** Drone collision set (PRD §5); the shapes are measured from drone.glb (airframes/colliders.ts). */
export const DRONE_COLLIDERS = {
  /** Radius of the contact balls under each motor (m). */
  footRadiusM: 0.006,
  /** Prop-disc sensors: thin cylinders at each rotor, for prop-strike detection. */
  propDiscHalfHeightM: 0.006,
};

/** The launch pad in the physics world: a thin disc on the ground at the origin. */
export const PAD_COLLIDER = { radiusM: 0.32, thicknessM: 0.004 };

export const IMPACT = {
  /** Contact accelerations above this (g) count as impacts (audio, crash detection). */
  minG: 3,
};
