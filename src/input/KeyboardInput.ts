import { KEYBOARD } from '../config/input';
import { type DeviceFrame, type InputAction } from './types';

type KeyName = keyof typeof KEYBOARD.keys;

const ACTIONS: InputAction[] = [
  'plugToggle',
  'armToggle',
  'kill',
  'cameraCycle',
  'feedCycle',
  'beaconToggle',
  'motorTest',
  'payloadToggle',
  'hideUi',
  'fullscreen',
  'settings',
  'reset',
  'modeCycle',
  'turtleToggle',
];

/** Keys that steer; the page must not scroll on them. */
const AXIS_KEYS: KeyName[] = ['yawLeft', 'yawRight', 'pitchForward', 'pitchBack', 'rollLeft', 'rollRight'];

/** Keyboard (PRD §4.7): W/S slew throttle (Shift = faster), 0 zeroes it, the rest are actions. */
export class KeyboardInput {
  throttle = 0;
  /** Slewed stick positions from held keys (−1..1). */
  axes = { roll: 0, pitch: 0, yaw: 0 };
  private held = new Set<string>();
  private queue: InputAction[] = [];
  private touched = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => this.onKey(e, true));
    target.addEventListener('keyup', (e) => this.onKey(e, false));
    target.addEventListener('blur', () => this.held.clear());
  }

  private is(code: string, key: KeyName): boolean {
    return KEYBOARD.keys[key].includes(code);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (down && (e.ctrlKey || e.metaKey || e.altKey)) return; // leave browser shortcuts alone
    if (down) this.held.add(e.code);
    else this.held.delete(e.code);
    if (AXIS_KEYS.some((k) => this.is(e.code, k))) e.preventDefault();
    if (!down || e.repeat) return;
    this.touched = true;
    const action = ACTIONS.find((a) => this.is(e.code, a as KeyName));
    if (action) {
      this.queue.push(action);
      e.preventDefault();
    }
    if (this.is(e.code, 'throttleZero')) this.throttle = 0;
  }

  private anyHeld(key: KeyName): boolean {
    return KEYBOARD.keys[key].some((c) => this.held.has(c));
  }

  poll(dt: number): DeviceFrame {
    const rate = this.anyHeld('fast') ? KEYBOARD.throttleRateFast : KEYBOARD.throttleRate;
    const up = this.anyHeld('throttleUp');
    const down = this.anyHeld('throttleDown');
    if (up) this.throttle += rate * dt;
    if (down) this.throttle -= rate * dt;
    this.throttle = Math.min(1, Math.max(0, this.throttle));
    // Keys are all-or-nothing; ramp the stick so a tap is a nudge and a hold is a smooth input.
    const step = KEYBOARD.axisRate * dt;
    const slew = (v: number, plus: KeyName, minus: KeyName) => {
      const target = (Number(this.anyHeld(plus)) - Number(this.anyHeld(minus))) * KEYBOARD.axisMax;
      return v + Math.max(-step, Math.min(step, target - v));
    };
    this.axes = {
      roll: slew(this.axes.roll, 'rollRight', 'rollLeft'),
      pitch: slew(this.axes.pitch, 'pitchForward', 'pitchBack'),
      yaw: slew(this.axes.yaw, 'yawRight', 'yawLeft'),
    };
    const steering = AXIS_KEYS.some((k) => this.anyHeld(k));
    const actions = this.queue;
    this.queue = [];
    const active = this.touched || up || down || steering;
    this.touched = false;
    return {
      throttle: this.throttle,
      yaw: this.axes.yaw,
      pitch: this.axes.pitch,
      roll: this.axes.roll,
      arm: false,
      kill: this.anyHeld('kill'),
      actions,
      active,
    };
  }
}
