// Input tunables and bindings (PRD §4.7).

export type ThrottleSource = 'trigger' | 'stick';

export const KEYBOARD = {
  /** Throttle slew while W/S is held (fraction per second); Shift for fast. */
  throttleRate: 0.6,
  throttleRateFast: 1.5,
  keys: {
    plugToggle: ['KeyP'],
    armToggle: ['Space'],
    kill: ['KeyX'],
    throttleUp: ['KeyW'],
    throttleDown: ['KeyS'],
    throttleZero: ['Digit0', 'Numpad0'],
    cameraCycle: ['KeyC'],
    feedCycle: ['KeyV'],
    beaconToggle: ['KeyB'],
    motorTest: ['KeyM'],
    payloadToggle: ['KeyL'],
    hideUi: ['KeyH'],
    fullscreen: ['KeyF'],
    settings: ['KeyO'],
    reset: ['KeyR'],
    fast: ['ShiftLeft', 'ShiftRight'],
  },
};

/** Chrome "standard" gamepad mapping indices (DualShock 4 / DualSense names). */
export const PAD = {
  cross: 0,
  circle: 1,
  square: 2,
  triangle: 3,
  l1: 4,
  r1: 5,
  l2: 6,
  r2: 7,
  share: 8,
  options: 9,
  l3: 10,
  r3: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
  ps: 16,
  touchpad: 17,
  axes: { lx: 0, ly: 1, rx: 2, ry: 3 },
} as const;

export const GAMEPAD = {
  /** Bench default: R2 analog. 'stick' = Mode 2 left stick Y (bottom → top = 0 → 1). */
  throttleSource: 'trigger' as ThrottleSource,
  /**
   * Stick throttle on a self-centering pad: accumulate instead of following the stick, so
   * pushing up raises throttle and letting go holds it (rate = fraction per second at full deflection).
   */
  throttleHold: false,
  throttleHoldRate: 0.8,
  /** Stick deadzone (radial, per stick) and expo (0 = linear, 1 = cubic). */
  deadzone: 0.08,
  expo: 0.3,
  /** Trigger deadzone: a finger resting on a DS4's R2 reads 0.05–0.07, which must stay 0%. */
  triggerDeadzone: 0.08,
  /** A button counts as pressed above this (analog triggers report 0..1). */
  pressThreshold: 0.5,
  /** Options must be held this long to plug / unplug the battery. */
  plugHoldS: 0.6,
  bindings: {
    armToggle: PAD.r1,
    killModifier: PAD.l1,
    plugHold: PAD.options,
    cameraCycle: PAD.triangle,
    feedCycle: PAD.square,
    beaconToggle: PAD.circle,
    motorTest: PAD.touchpad,
    payloadToggle: PAD.share,
    reset: PAD.down,
  },
  /** The same action from a second pad within this window is a duplicate (DS4Windows, Steam Input). */
  duplicateWindowS: 0.25,
  /** Movement that counts as "using the pad" for the active-device switch. */
  activityThreshold: 0.2,
};

export const HAPTICS = {
  enabled: true,
  /** Weak motor tracks average RPM / rpmMax, scaled. */
  weakMax: 0.35,
  /** Strong pulse on ESC / FC beeps and arming. */
  pulseStrong: 0.6,
  pulseMs: 90,
  /** Re-issue interval for the continuous rumble (effects are fire-and-forget with a duration). */
  refreshMs: 100,
};

export const RADIO = {
  /** localStorage key for per-device calibration. */
  storageKey: 'propwash.radio.v1',
  /** An axis must travel this far (of its range) to count as "moved" in the wizard. */
  detectTravel: 0.5,
  /** Switch channels above this are "on". */
  switchOn: 0.5,
  deadzone: 0.02,
  /** Non-standard devices that are not radios (wheels, pedals): ignored, never offered calibration. */
  ignore: /wheel|pedal|driving force|shifter/i,
};
