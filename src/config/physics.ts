// Flight physics stepping (Phase 2 PRD §1). SI units.

export const PHYSICS = {
  /** Physics + flight controller rate (Hz). */
  rateHz: 1000,
  /**
   * At most this many steps per rendered frame; beyond it the sim runs slow-motion instead of
   * spiralling. At 1 kHz a 60 fps frame needs 17: 40 keeps real time down to 25 fps.
   */
  maxStepsPerFrame: 40,
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

/**
 * Field objects near the drone are in the physics world; the rest are added as it approaches.
 * Rapier's step costs about 70 ns per collider even when static or disabled, and the field has
 * 900 of them (mostly poles). Within this radius (plus the object's own) they exist, refreshed
 * every `refreshSteps`: at 90 m/s the drone covers 1.8 m between refreshes.
 */
export const FIELD_STREAMING = { radiusM: 30, refreshSteps: 20 };

/** The launch pad in the physics world: a thin disc on the ground at the origin. */
export const PAD_COLLIDER = { radiusM: 0.32, thicknessM: 0.004 };

export const IMPACT = {
  /** Contact accelerations above this (g) count as impacts (audio, crash detection). */
  minG: 3,
};
