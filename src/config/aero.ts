// Air, body aerodynamics, wind and prop wash (Phase 2 PRD §2.3–§2.4). SI units.

export type WindPreset = 'calm' | 'light' | 'breezy';

export const AIR = {
  /** Sea-level air density (kg/m³). */
  rho: 1.225,
};

export const BODY_AERO = {
  /** Angular damping: τ = −cω·ω_body (N·m·s). Small: the rate PID does the real work. */
  angularDamping: 2e-4,
};

/**
 * Wind: a constant vector plus Dryden-lite gusts (3-axis first-order filtered noise with a standard
 * deviation σ and a length scale L; correlation time L / max(airspeed, minSpeed)).
 */
export const WIND = {
  default: 'light' as WindPreset,
  presets: {
    calm: { meanMs: 0, sigmaMs: 0 },
    light: { meanMs: 2, sigmaMs: 1 },
    breezy: { meanMs: 6, sigmaMs: 3 },
  } satisfies Record<WindPreset, { meanMs: number; sigmaMs: number }>,
  /** Direction the wind blows toward, as a heading from −Z (north) toward +X (east), radians. */
  headingRad: Math.PI / 2,
  /** Gust length scales (m): horizontal, vertical. */
  lengthScaleM: { horizontal: 30, vertical: 10 },
  /** Vertical gusts are weaker near the ground. */
  verticalSigmaFactor: 0.5,
  minSpeedMs: 1,
};

/** Prop wash / vortex ring (PRD §2.4). Used by the coupling task (group 4). */
export const PROP_WASH = {
  /** Onset: v_in < −onset · v_induced. */
  onsetInducedFraction: 0.6,
  /** Severity reaches 1 this much further into the wake (× v_induced). */
  fullInducedFraction: 0.8,
  /** Severity fades out as horizontal airspeed passes this (m/s). */
  fadeHorizontalMs: 4,
  /** Band of the random thrust fluctuations (Hz). */
  bandHz: [10, 40] as const,
  /** At full severity: mean thrust lost, and the fluctuation's RMS (fractions of thrust). */
  thrustLoss: 0.15,
  fluctuation: 0.8,
  /** Severity smoothing (Hz): the wake builds and clears over tens of milliseconds. */
  severityLpfHz: 8,
  /** Floor for the induced-velocity estimate at very low thrust (N). */
  minThrustN: 0.2,
};

/** Turtle mode (PRD §3.7): props run in reverse, far less efficient than forward. */
export const TURTLE = {
  /** Reverse thrust as a fraction of forward thrust at the same speed. */
  reverseThrustFactor: 0.55,
  /** Betaflight flip_over_after_crash_power_factor: full stick = this fraction of full command. */
  powerFactor: 0.65,
  /** Betaflight crashflip_expo: stick → power curve, so small inputs give gentle nudges. */
  expo: 0.35,
  /** Upright again (tilt below this, deg) while on the ground: turtle ends and the quad disarms. */
  uprightDeg: 35,
  /** Counts as upside down for turtle when tilted more than this (deg). */
  invertedDeg: 100,
};
