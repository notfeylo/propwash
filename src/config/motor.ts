// Motor, battery and power-state tunables (PRD §4.4) for a typical 7" long-range build:
// 2807 1300 KV motors (12N14P, 7 pole pairs), 6S battery, 3-blade 7" props.

export const MOTOR = {
  kv: 1300,
  polePairs: 7,
  motorCount: 4,
  /** DShot idle 5.5% ≈ 2,400 RPM. */
  rpmIdle: 2400,
  /** rpmMaxLoaded = loadedFraction × KV × Vbat (props loaded vs free spin). */
  loadedFraction: 0.75,
  /** Throttle curve exponent: curve(x) = x^exponent. */
  curveExponent: 0.8,
  /** Audio reference: the recorded loop is mapped to this RPM (PRD §4.5). */
  rpmHover: 11000,
  /** First-order lag time constants (s). */
  tauUp: 0.06,
  tauDown: 0.12,
  /** Unpowered coast-down (disarm, kill, unplug) for 7" props (s). */
  tauCoast: 0.9,
  /** Below this, a coasting motor is considered stopped. */
  stopRpm: 25,
  /**
   * Overshoot on throttle snaps. While driven, RPM follows the command as a lightly underdamped
   * spring (ζ) whose natural frequency is riseFactor/τ, so it still reaches 63% at τup/τdown like
   * the PRD's first-order lag, but a snap overshoots by ≈2%. Slow throttle moves don't ring.
   * (ζ 0.78 → ωn·t63 = 1.84, 2.0% overshoot.)
   */
  overshoot: { dampingRatio: 0.78, riseFactor: 1.84 },
  /** Per-motor RPM variance: slow noise ±0.7% (3–8 Hz) plus a fixed ±0.3% offset. */
  variance: { noiseFraction: 0.007, noiseHz: [3, 8] as const, offsetFraction: 0.003 },
  /** Motor integration substep (Hz). */
  substepHz: 1000,
};

export const ARMING = {
  /** Arming is allowed only at or below this throttle (Betaflight min_check-like). */
  maxThrottle: 0.05,
  /** Rotors reach idle in this time after arming… */
  idleRampS: 0.15,
  /** …or this with the soft-arm option. */
  softIdleRampS: 0.6,
  softArm: false,
  /** Each motor starts its ramp after a random delay in [0, stagger]. */
  staggerS: 0.04,
  /** Throttle above this counts as SPINNING rather than ARMED at idle. */
  spinningThrottle: 0.05,
};

export const POWER = {
  /** OFF → BOOTING → DISARMED once the ESC init tones are done (s). */
  bootDurationS: 1.2,
  /** ESC power-on tones start this long after the plug-in tick (s). */
  escTonesAtS: 0.15,
  /** "Signal detected" tones, ~1 s after power-on (s). */
  signalTonesAtS: 0.95,
};

export const BATTERY = {
  cells: 6,
  capacityMah: 4000,
  /** Pack internal resistance (Ω). */
  resistanceOhm: 0.028,
  /** Electronics draw (FC, VTX, receiver), A. */
  baseCurrentA: 0.6,
  /** Motor current I = k·Σ(rpm/1000)³, tuned so all four at full loaded RPM draw ≈ 90 A. */
  currentPerKrpm3: 0.0015,
  /** Open-circuit volts per cell vs state of charge (Li-ion, 18650/21700 style). */
  ocvCurve: [
    [0, 3.0],
    [0.05, 3.3],
    [0.1, 3.45],
    [0.3, 3.62],
    [0.5, 3.75],
    [0.7, 3.9],
    [0.9, 4.08],
    [1, 4.2],
  ] as const,
  /** Min per-cell voltage (PRD: 3.5 V/cell) — below this under load the low-battery beeper runs. */
  warnCellV: 3.5,
  /** Low-battery must persist this long before the beeper starts (filters sag spikes), s. */
  warnHoldS: 2,
  /** Voltage filter time constant for display and warnings (s). */
  filterTauS: 0.15,
};
