// Input tunables (PRD §4.7). Task 7 adds gamepad, RC radio and rebinding on top of these.

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
    beaconToggle: ['KeyB'],
    payloadToggle: ['KeyL'],
    fast: ['ShiftLeft', 'ShiftRight'],
  },
};
