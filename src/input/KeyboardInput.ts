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
];

/** Keyboard (PRD §4.7): W/S slew throttle (Shift = faster), 0 zeroes it, the rest are actions. */
export class KeyboardInput {
  throttle = 0;
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
    const actions = this.queue;
    this.queue = [];
    const active = this.touched || up || down;
    this.touched = false;
    return {
      throttle: this.throttle,
      yaw: 0,
      pitch: 0,
      roll: 0,
      arm: false,
      kill: this.anyHeld('kill'),
      actions,
      active,
    };
  }
}
