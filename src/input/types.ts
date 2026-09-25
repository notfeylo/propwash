export type InputAction =
  | 'plugToggle'
  | 'armToggle'
  /** Level-triggered arm (RC switch flipped on); refused like a toggle when unsafe. */
  | 'arm'
  | 'disarm'
  | 'kill'
  | 'cameraCycle'
  | 'feedCycle'
  | 'beaconToggle'
  | 'motorTest'
  | 'payloadToggle'
  | 'hideUi'
  | 'fullscreen';

export type InputDevice = 'keyboard' | 'gamepad' | 'radio';

/** One frame of device-independent input (PRD §4.7). Phase 1 uses throttle, arm, kill and actions. */
export interface ControlState {
  /** 0..1 */
  throttle: number;
  /** −1..1 (recorded, not yet used: no flight in Phase 1). */
  yaw: number;
  pitch: number;
  roll: number;
  /** Arm control held / switch on. */
  arm: boolean;
  /** Kill held (L1 + R1, X, or a radio kill switch). */
  kill: boolean;
  /** Edge-triggered actions this frame, in order. */
  actions: InputAction[];
  /** Device that produced the sticks and throttle this frame. */
  device: InputDevice;
  /** Human-readable device name (gamepad id, "Keyboard"). */
  deviceName: string;
}

/** What each device reports per poll; the InputManager merges these. */
export interface DeviceFrame {
  throttle: number;
  yaw: number;
  pitch: number;
  roll: number;
  arm: boolean;
  kill: boolean;
  actions: InputAction[];
  /** The user touched this device this frame (for the active-device switch). */
  active: boolean;
}

export const emptyFrame = (): DeviceFrame => ({
  throttle: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  arm: false,
  kill: false,
  actions: [],
  active: false,
});

/** The subset of the Gamepad API the input code reads (so tests can pass plain objects). */
export interface PadSnapshot {
  id: string;
  index: number;
  mapping: string;
  connected: boolean;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
  vibrationActuator?: {
    playEffect?: (type: string, params: Record<string, number>) => Promise<unknown>;
  } | null;
}
