import { GAMEPAD, PAD, type ThrottleSource } from '../config/input';
import { type DeviceFrame, type InputAction, type PadSnapshot } from './types';

/** Deadzone, rescale to full range, then expo (0 = linear, 1 = cubic). */
export function shapeAxis(v: number, deadzone = GAMEPAD.deadzone, expo = GAMEPAD.expo): number {
  const a = Math.abs(v);
  if (a <= deadzone) return 0;
  const x = Math.min(1, (a - deadzone) / (1 - deadzone));
  return Math.sign(v) * (x * (1 - expo) + x * x * x * expo);
}

/**
 * Radial deadzone for a two-axis stick (diagonals keep their direction), then expo per axis.
 * Rescaling is by radius and each axis clamps at 1, so a full diagonal reaches both corners.
 */
export function shapeStick(x: number, y: number, deadzone = GAMEPAD.deadzone, expo = GAMEPAD.expo): [number, number] {
  const m = Math.hypot(x, y);
  if (m <= deadzone) return [0, 0];
  const k = (m - deadzone) / (1 - deadzone) / m;
  const axis = (v: number) => {
    const c = Math.max(-1, Math.min(1, v * k));
    return c * (1 - expo) + c * c * c * expo;
  };
  return [axis(x), axis(y)];
}

/** Friendly name from a Gamepad id (Chrome: "... (STANDARD GAMEPAD Vendor: 054c Product: 09cc)"). */
export function padName(id: string): string {
  const s = id.toLowerCase();
  const vendor = /vendor:\s*([0-9a-f]{4})/.exec(s)?.[1] ?? /^([0-9a-f]{4})-/.exec(s)?.[1];
  const product = /product:\s*([0-9a-f]{4})/.exec(s)?.[1] ?? /^[0-9a-f]{4}-([0-9a-f]{4})/.exec(s)?.[1];
  if (vendor === '054c') {
    if (product === '0ce6' || product === '0df2') return 'DualSense';
    return 'DualShock 4';
  }
  if (s.includes('dualsense')) return 'DualSense';
  if (s.includes('wireless controller') || s.includes('dualshock')) return 'DualShock 4';
  if (vendor === '045e' || s.includes('xbox') || s.includes('xinput')) return 'Xbox controller';
  const plain = id.replace(/\s*\(.*\)\s*$/, '').trim();
  return plain || 'Gamepad';
}

/**
 * One standard-mapping gamepad (PS4 DualShock 4 / PS5 DualSense in Chrome), PRD §4.7:
 * R2 throttle (or Mode 2 left stick, optionally held), R1 arm toggle, L1+R1 kill, Options held
 * 0.6 s for the battery, Triangle/Square camera/feed, Circle beacon, touchpad motor test,
 * Share payload. Sticks are Mode 2 with a radial deadzone and expo.
 */
export class GamepadInput {
  throttleSource: ThrottleSource = GAMEPAD.throttleSource;
  throttleHold = GAMEPAD.throttleHold;
  readonly name: string;
  private prev: boolean[] = [];
  private held = 0;
  /** Stick and trigger positions when the pad last counted as "in use". */
  private anchor: number[] | null = null;
  private plugFired = false;
  private heldThrottle = 0;
  /** Last raw snapshot (for the visualizer). */
  last: PadSnapshot | null = null;

  constructor(readonly id: string) {
    this.name = padName(id);
  }

  private down(pad: PadSnapshot, i: number): boolean {
    const b = pad.buttons[i];
    return !!b && (b.pressed || b.value > GAMEPAD.pressThreshold);
  }

  poll(pad: PadSnapshot, dt: number): DeviceFrame {
    this.last = pad;
    const B = GAMEPAD.bindings;
    const now = pad.buttons.map((_, i) => this.down(pad, i));
    const edge = (i: number) => now[i] && !this.prev[i];
    const actions: InputAction[] = [];

    const l1 = now[B.killModifier];
    const r1 = now[B.armToggle];
    if (edge(B.armToggle)) actions.push(l1 ? 'kill' : 'armToggle');
    else if (edge(B.killModifier) && r1) actions.push('kill');

    if (now[B.plugHold]) {
      this.held += dt;
      if (!this.plugFired && this.held >= GAMEPAD.plugHoldS) {
        this.plugFired = true;
        actions.push('plugToggle');
      }
    } else {
      this.held = 0;
      this.plugFired = false;
    }

    const taps: [number, InputAction][] = [
      [B.cameraCycle, 'cameraCycle'],
      [B.feedCycle, 'feedCycle'],
      [B.beaconToggle, 'beaconToggle'],
      [B.motorTest, 'motorTest'],
      [B.payloadToggle, 'payloadToggle'],
      [B.reset, 'reset'],
      [B.modeCycle, 'modeCycle'],
      [B.turtleToggle, 'turtleToggle'],
      [B.landToggle, 'landToggle'],
    ];
    for (const [i, a] of taps) if (edge(i)) actions.push(a);

    const ax = (i: number) => pad.axes[i] ?? 0;
    const [yaw, ly] = shapeStick(ax(PAD.axes.lx), ax(PAD.axes.ly));
    const [roll, ry] = shapeStick(ax(PAD.axes.rx), ax(PAD.axes.ry));

    let throttle: number;
    if (this.throttleSource === 'trigger') {
      const v = pad.buttons[PAD.r2]?.value ?? 0;
      const dz = GAMEPAD.triggerDeadzone;
      throttle = Math.max(0, Math.min(1, (v - dz) / (1 - dz)));
    } else if (this.throttleHold) {
      this.heldThrottle = Math.max(0, Math.min(1, this.heldThrottle - ly * GAMEPAD.throttleHoldRate * dt));
      throttle = this.heldThrottle;
    } else {
      // Bottom → top = 0 → 1 (up is −1 on the Y axis). A self-centering stick rests at 50%.
      throttle = Math.max(0, Math.min(1, (1 - ax(PAD.axes.ly)) / 2));
    }

    // In use = a button press or a stick/trigger *moving*, not merely resting off-centre (a Mode 2
    // throttle held at the bottom would otherwise lock out the keyboard).
    const T = GAMEPAD.activityThreshold;
    const pos = [...pad.axes, pad.buttons[PAD.r2]?.value ?? 0];
    const moved = this.anchor !== null && pos.some((v, i) => Math.abs(v - (this.anchor![i] ?? v)) > T);
    if (this.anchor === null || moved) this.anchor = pos;
    const active = now.some((d, i) => d && !this.prev[i]) || moved;
    this.prev = now;

    return {
      throttle,
      yaw,
      pitch: -ry, // stick forward = +pitch (nose down)
      roll,
      arm: r1 && !l1,
      kill: l1 && r1,
      actions,
      active,
    };
  }
}
