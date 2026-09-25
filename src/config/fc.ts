// Flight controller (Phase 2 PRD §3), Betaflight-faithful. Rates in deg/s at the stick, gains in
// physical units: the rate PID outputs angular acceleration (rad/s²), which the mixer turns into
// torque with the airframe's inertia.

export type RatesModel = 'actual' | 'betaflight' | 'raceflight' | 'kiss';
export type FlightMode = 'acro' | 'angle' | 'horizon';

/** Three numbers per axis; their meaning depends on the model (see `src/sim/fc/rates.ts`). */
export interface RateParams {
  /** Actual: center (deg/s) · Betaflight: RC rate · RaceFlight: rate (deg/s) · KISS: RC rate. */
  a: number;
  /** Actual: max rate (deg/s) · Betaflight: super rate · RaceFlight: acro+ · KISS: rate. */
  b: number;
  /** Expo (Actual, Betaflight, RaceFlight) or curve (KISS). */
  c: number;
}

export interface AxisGains {
  /** s⁻¹ */
  kp: number;
  /** s⁻² */
  ki: number;
  /** s */
  kd: number;
  /** dimensionless: fraction of the setpoint's angular acceleration fed forward */
  ff: number;
}

export const RATES = {
  model: 'actual' as RatesModel,
  /** Defaults per model; each applies to roll, pitch and yaw unless overridden. */
  defaults: {
    actual: { a: 70, b: 670, c: 0.54 },
    betaflight: { a: 1.0, b: 0.7, c: 0 },
    raceflight: { a: 370, b: 80, c: 50 },
    kiss: { a: 1.0, b: 0.7, c: 0.4 },
  } satisfies Record<RatesModel, RateParams>,
  /** Betaflight's hard limit on any rate (deg/s). */
  maxDegS: 1998,
};

export const RC_SMOOTHING = {
  /** Setpoint (and throttle) smoothing: PT3, cutoff set from this group delay (≈15 ms, auto). */
  delayS: 0.015,
  /** Feedforward jitter reduction: FF fades in over this setpoint acceleration (deg/s²). */
  ffJitterDegS2: 300,
};

export const PID = {
  /**
   * Retuned against the full §2 physics (PRD §3.4 started from Kp 10, Ki 5, Kd 0.03, FF 0.8; yaw
   * Kp 8, Ki 5, Kd 0, FF 0.6). Per-rotor inflow gives real propeller damping and the rotor-inertia
   * term makes yaw very fast, which that tune didn't account for. See DECISIONS 2026-09-25.
   */
  roll: { kp: 18.2, ki: 12, kd: 0.278, ff: 0.58 } satisfies AxisGains,
  pitch: { kp: 18.2, ki: 12, kd: 0.278, ff: 0.58 } satisfies AxisGains,
  yaw: { kp: 12, ki: 50, kd: 0.03, ff: 0.3 } satisfies AxisGains,
  /** I-term clamp (rad/s²). */
  iLimit: 150,
  /**
   * I-term relax: I stops accumulating while the setpoint (Betaflight's default) or the gyro moves
   * fast; the relax factor is 1 − |high-pass| / threshold.
   */
  iRelax: { type: 'gyro' as 'setpoint' | 'gyro', cutoffHz: 15, thresholdDegS: 40, axes: ['roll', 'pitch'] as const },
  /** TPA: D attenuated linearly from the breakpoint to this fraction at full throttle. */
  tpa: { breakpoint: 0.65, rate: 0.3 },
  /** D-term low-pass on the (already filtered) gyro (Hz). */
  dtermLpfHz: 110,
  /**
   * "Betaflight numbers" view (0–200 scale): one linear factor per term, shared by all axes. Roll
   * and pitch read P 45 / I 48 / D 40 / F 120; yaw P 30 / I 200 / D 4 / F 62.
   */
  bfScale: { kp: 18.2 / 45, ki: 0.25, kd: 0.278 / 40, ff: 0.58 / 120 },
};

export const MIXER = {
  airmode: true,
  /**
   * Betaflight airmode_start_throttle_percent: airmode (and the PID below low throttle) only
   * engages once the throttle has passed this after arming, so an armed quad idles evenly on the pad.
   */
  airmodeStartThrottle: 0.25,
  /** Below this throttle, before airmode engages, the PID output is held at zero (no ground wobble). */
  lowThrottle: 0.05,
};

export const SENSORS = {
  /** Debug: true body rates and attitude, no noise, no filters. */
  ideal: false,
  gyro: {
    /** White noise (deg/s, 1σ per sample). */
    noiseDegS: 0.3,
    /** Bias random walk (deg/s per √s); the gyro is calibrated (bias 0) at boot. */
    biasWalkDegS: 0.002,
    /** Motor-imbalance vibration seen by the gyro at 1% imbalance and full speed (deg/s amplitude). */
    vibrationDegS: 25,
    lpfHz: 90,
    /** RPM filter: one notch per motor at its rotor frequency. */
    rpmNotch: { enabled: true, q: 5, minHz: 80 },
  },
  acc: {
    /** Noise (m/s², 1σ per sample) and low-pass (Hz). */
    noise: 0.25,
    lpfHz: 10,
  },
  /** Attitude estimator (Mahony complementary filter): accelerometer trust (s⁻¹) and bias learning (s⁻²). */
  attitude: { kp: 0.8, ki: 0.02, accTrustBandG: 0.25 },
};

export const MODES = {
  default: 'acro' as FlightMode,
  angle: { kLevel: 7, maxAngleDeg: 55 },
  /** Horizon: full self-level at centre stick, fading to acro toward this stick deflection. */
  horizon: { fullAcroStick: 0.75 },
};

export const ARMING_FC = {
  /** Betaflight small_angle: no arming above this tilt (deg). */
  maxTiltDeg: 25,
  /** Crash detection (off by default, as in Betaflight): disarm above this impact (g). */
  crashDetection: { enabled: false, impactG: 12 },
};
