// Drone asset facts (PRD §2.1, §4.1) and rig tunables (PRD §4.3).

import { BATTERY, MOTOR } from './motor';

const DEG = Math.PI / 180;

type Vec3 = [number, number, number];

export const DRONE = {
  modelUrl: '/models/drone.glb',
  /** Betaflight motor order M1..M4. */
  rotorNames: ['rotor_RR', 'rotor_FR', 'rotor_RL', 'rotor_FL'] as const,
  propRadiusM: 0.0889,
  bladeCount: 3,
  /** Rotor vertices farther than this from the motor axis are prop blades; the rest is the bell/hub. */
  hubRadiusM: 0.017,
  /**
   * Body loose parts inside the canister footprint that reach below this height (body frame, m)
   * are the canister's straps; they are toggled with the payload.
   */
  payloadStrapBelowY: 0.03,
  /** No-load max RPM at a full pack: KV × 4.2 V × cells (32,760). Scales vibration and air noise. */
  rpmMax: MOTOR.kv * 4.2 * BATTERY.cells,
} as const;

/**
 * Prop visual stages (PRD §4.3): real mesh → real mesh + sub-frame smear → blur disc.
 * Each weight is a smoothstep between two RPMs, so every crossfade is continuous.
 */
export const PROP_BLEND = {
  /** Real blades fade from 1 → 0 across this range. */
  meshFade: [400, 2500] as const,
  /** Smear ghosts fade in… */
  smearIn: [400, 700] as const,
  /** …and back out as the disc takes over. */
  smearOut: [2100, 3000] as const,
  /** Blur disc fades in. */
  discIn: [1900, 2700] as const,
  /** Ghost copies per rotor (PRD: 6–8). */
  ghosts: 8,
  /** Frame time used to size the smear when the sim clock is frozen (screenshots). */
  nominalFrameDtS: 1 / 60,
};

export const PROP_DISC = {
  innerRadiusM: 0.012,
  /** Fraction of the rotor disc the blades cover (3 × blade chord / circumference, averaged). */
  coverage: 0.18,
  /** Relative density at the hub vs the tip (blades taper). */
  hubDensity: 1.6,
  tipDensity: 0.6,
  /**
   * Time-averaged blade glints, added to the sampled prop color (linear). Alpha scales the disc's
   * lit specular just like its color, so without this a dark prop vanishes over a dark floor.
   */
  sheenLift: 0.07,
  /** Soft fade over the last fraction of the radius. */
  tipFade: 0.06,
  innerFade: 0.08,
  /** Faint "ghost blade" streak turning at the aliased (strobed) rate, slowed for comfort. */
  streakStrength: 1.1,
  streakSharpness: 6,
  streakSlowdown: 0.2,
  /** Sheen band: lower roughness at this normalized radius. */
  sheenCenter: 0.62,
  sheenWidth: 0.32,
  roughness: 0.62,
  sheenRoughness: 0.42,
  /** Environment reflection scale: a flat disc at grazing angles mirrors the softboxes (Fresnel → 1). */
  envIntensity: 0.45,
  /** Used if the prop color can't be sampled from the texture. */
  fallbackColor: 0x1a1b1d,
};

export const VIBRATION = {
  /** Peak body jitter at rpmMax (PRD: ±0.15 mm, ±0.05°), scaled by (rpm/rpmMax)². */
  positionM: 0.00015,
  rotationRad: 0.05 * DEG,
  /** Per-motor phase random walk (rad/√s): real motors never stay in phase. */
  phaseNoise: 2.5,
};

export const ANTENNA = {
  /** Damped spring on rotation.x/z (PRD: k ≈ 60, ζ ≈ 0.15). Unit inertia. */
  stiffness: 60,
  dampingRatio: 0.15,
  /** Angular acceleration (rad/s²) per unit vibration intensity, as band-limited noise. */
  vibrationDrive: 9,
  /** Angular acceleration per m/s² of body acceleration (Phase 2 flight will drive this). */
  accelDrive: 0.9,
  maxAngleRad: 12 * DEG,
  substepHz: 240,
};

/** Positions are in the drone body's frame (m): Y-up, nose = -Z. Found by raycasting the FC/VTX boards. */
export const LEDS = {
  /** Emissive intensity; well above the bloom threshold so LEDs glow slightly. */
  intensity: 8,
  fc: { color: 0x2f7bff, blinkHz: 2.5, radiusM: 0.0014, position: [0.0172, 0.0604, 0.004] as Vec3 },
  vtx: { colors: { red: 0xff2a1a, green: 0x22ff55 }, radiusM: 0.0012, position: [0.0125, 0.0624, 0.059] as Vec3 },
  rearStrip: {
    color: 0xff3355,
    count: 6,
    spacingM: 0.008,
    radiusM: 0.0018,
    enabledByDefault: false,
    position: [0, 0.0585, 0.1105] as Vec3,
    direction: [1, 0, 0] as Vec3,
  },
};

export const SPIN_ARROWS = {
  radiusM: 0.055,
  tubeM: 0.0022,
  arcRad: 1.5 * Math.PI,
  heightAboveRotorM: 0.03,
  colors: { CW: 0xff6a2a, CCW: 0x27c7ff },
};
