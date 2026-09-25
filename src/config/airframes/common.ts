// Shared motor, prop and geometry constants for every 7" preset (Phase 2 PRD §2.1–§2.2).
// Geometry comes from drone.glb (model frame: meters, Y-up, nose −Z, right +X).

const RPM_TO_RADS = (2 * Math.PI) / 60;
export const rpmToRads = (rpm: number) => rpm * RPM_TO_RADS;
export const radsToRpm = (rads: number) => rads / RPM_TO_RADS;

/** Frame + battery bounding-box centre of drone.glb (antenna whip and props excluded; see DECISIONS). */
export const BODY_BBOX_CENTER: readonly [number, number, number] = [0, 0.0738, 0];
/** CoM shift when the payload canister is fitted (PRD §2.1). */
export const PAYLOAD_COM_SHIFT_Y = -0.01;

/**
 * Rotors in Betaflight order M1..M4 (props-in): prop disc centre on the motor axis (model frame)
 * and spin seen from above: +1 = CCW (+Y rotation in three.js), −1 = CW.
 */
export const ROTORS = [
  { name: 'M1', position: [0.1217, 0.07, 0.1233], spin: -1 },
  { name: 'M2', position: [0.1217, 0.07, -0.1233], spin: 1 },
  { name: 'M3', position: [-0.1217, 0.07, 0.1233], spin: 1 },
  { name: 'M4', position: [-0.1217, 0.07, -0.1233], spin: -1 },
] as const;

/** 2807 1300 KV motors with 7×4×3 props. */
export const MOTOR_PROP = {
  kv: 1300,
  /** Loaded max speed: ω_max = loadedFraction · KV · V_loaded (rpm → rad/s). */
  loadedFraction: 0.75,
  /** DShot idle 5.5% ≈ 2,400 rpm. */
  idleRads: rpmToRads(2400),
  /** First-order speed lag while driven (s); down is faster with DShot active braking. */
  tauUpS: 0.035,
  tauDownS: 0.05,
  /** Unpowered free coast (disarm, kill, unplug), as on the bench (Phase 1 §4.4). */
  tauCoastS: 0.9,
  /** Below this a coasting motor stops (rad/s). */
  stopRads: rpmToRads(25),
  /** Thrust coefficient: T = kT·ω² (N per (rad/s)²); 18.6 N static at ω_max(25.2 V). */
  kT: 2.815e-6,
  /** Reaction torque coefficient: Q = kQ·ω², kQ = 0.015·kT. */
  kQ: 0.015 * 2.815e-6,
  propRadiusM: 0.0889,
  bladeCount: 3,
  /** Geometric pitch (4″) and the effective-pitch factor for thrust fade with inflow. */
  pitchM: 0.1016,
  kEff: 1.7,
  /** Upper clamp of the inflow factor (descending into the disc raises thrust a little). */
  inflowFactorMax: 1.2,
  /** Ground effect clamp: GE(h) = 1/(1 − (R/4h)²) for h > R/2, at most 1.33. */
  groundEffectMax: 1.33,
  /** Prop + bell inertia about the motor axis (kg·m²): yaw kick and gyroscopic terms. */
  rotorInertia: 3.0e-5,
  gyroscopic: true,
  /** Rotor H-force (drag in the disc plane): F = −kD·ω·v_perp. */
  kD: 1.0e-5,
  /** Fixed per-motor imbalance range (fraction): cosmetic for the body, real for the gyro. */
  imbalance: [0.005, 0.015] as const,
  /** Motor + ESC efficiency for battery current: I = Σ(Q·ω)/(η·V). */
  efficiency: 0.8,
  /** Flight controller, receiver, VTX and camera draw (A). */
  electronicsA: 0.6,
};
