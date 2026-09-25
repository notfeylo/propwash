import { KEYBOARD } from '../config/input';

export type InputAction =
  'plugToggle' | 'armToggle' | 'kill' | 'beaconToggle' | 'payloadToggle' | 'cameraCycle' | 'feedCycle';

/** One frame of device-independent input (PRD §4.7). Phase 1 uses throttle + actions. */
export interface ControlState {
  throttle: number;
  yaw: number;
  pitch: number;
  roll: number;
  actions: InputAction[];
}

const ACTIONS: InputAction[] = [
  'plugToggle',
  'armToggle',
  'kill',
  'beaconToggle',
  'payloadToggle',
  'cameraCycle',
  'feedCycle',
];

/** Keyboard: W/S slew throttle (Shift = faster), 0 zeroes it, P/Space/X/B/L are actions. */
export class KeyboardInput {
  throttle = 0;
  private held = new Set<string>();
  private queue: InputAction[] = [];

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => this.onKey(e, true));
    target.addEventListener('keyup', (e) => this.onKey(e, false));
    target.addEventListener('blur', () => this.held.clear());
  }

  private is(code: string, key: keyof typeof KEYBOARD.keys): boolean {
    return KEYBOARD.keys[key].includes(code);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (down) this.held.add(e.code);
    else this.held.delete(e.code);
    if (!down || e.repeat) return;
    const action = ACTIONS.find((a) => this.is(e.code, a));
    if (action) {
      this.queue.push(action);
      e.preventDefault();
    }
    if (this.is(e.code, 'throttleZero')) this.throttle = 0;
  }

  private anyHeld(key: keyof typeof KEYBOARD.keys): boolean {
    return KEYBOARD.keys[key].some((c) => this.held.has(c));
  }

  poll(dt: number): ControlState {
    const rate = this.anyHeld('fast') ? KEYBOARD.throttleRateFast : KEYBOARD.throttleRate;
    if (this.anyHeld('throttleUp')) this.throttle += rate * dt;
    if (this.anyHeld('throttleDown')) this.throttle -= rate * dt;
    this.throttle = Math.min(1, Math.max(0, this.throttle));
    const actions = this.queue;
    this.queue = [];
    return { throttle: this.throttle, yaw: 0, pitch: 0, roll: 0, actions };
  }
}
