import { RADIO } from '../config/input';
import { type DeviceFrame, type InputAction, type PadSnapshot } from './types';

export interface AxisCal {
  index: number;
  min: number;
  max: number;
  center: number;
  invert: boolean;
}

export interface SwitchCal {
  kind: 'axis' | 'button';
  index: number;
  /** Raw value with the switch off and on. */
  off: number;
  on: number;
}

export interface RadioCalibration {
  id: string;
  throttle: AxisCal;
  yaw: AxisCal;
  pitch: AxisCal;
  roll: AxisCal;
  arm: SwitchCal | null;
}

export type CalStep = 'center' | 'throttle' | 'yaw' | 'pitch' | 'roll' | 'arm' | 'done';
export const CAL_STEPS: CalStep[] = ['center', 'throttle', 'yaw', 'pitch', 'roll', 'arm', 'done'];

export const CAL_PROMPTS: Record<CalStep, string> = {
  center: 'Center the sticks and put the throttle all the way down. Then press Next.',
  throttle: 'Move the throttle through its full range, then hold it at the TOP and press Next.',
  yaw: 'Move yaw (rudder) through its full range, then hold it fully RIGHT and press Next.',
  pitch: 'Move pitch (elevator) through its full range, then hold it fully UP (forward) and press Next.',
  roll: 'Move roll (aileron) through its full range, then hold it fully RIGHT and press Next.',
  arm: 'Flip your ARM switch ON and press Next (or Skip to arm from the keyboard or with R1).',
  done: 'Calibrated. Sticks and switches are live.',
};

const button = (pad: PadSnapshot, i: number) => pad.buttons[i]?.value ?? (pad.buttons[i]?.pressed ? 1 : 0);

/**
 * Calibration wizard logic (PRD §4.7): sample the sticks at rest, then for each channel find the
 * axis that travelled furthest, its endpoints, and whether "top/right" reads low (inverted).
 * The arm switch is whichever axis or button moved furthest from rest. Pure: feed it snapshots.
 */
export class RadioCalibrator {
  step: CalStep = 'center';
  error: string | null = null;
  private rest: number[] = [];
  private restButtons: number[] = [];
  private min: number[] = [];
  private max: number[] = [];
  private latest: PadSnapshot | null = null;
  private result: Partial<RadioCalibration> = {};

  constructor(readonly id: string) {}

  sample(pad: PadSnapshot): void {
    this.latest = pad;
    pad.axes.forEach((v, i) => {
      this.min[i] = Math.min(this.min[i] ?? v, v);
      this.max[i] = Math.max(this.max[i] ?? v, v);
    });
  }

  /** Axis currently travelling furthest in this step (for live feedback), or −1. */
  get leadingAxis(): number {
    return this.pickAxis()?.index ?? -1;
  }

  private used(): Set<number> {
    const r = this.result;
    return new Set([r.throttle, r.yaw, r.pitch, r.roll].filter((a): a is AxisCal => !!a).map((a) => a.index));
  }

  private pickAxis(): { index: number; travel: number } | null {
    const used = this.used();
    let best: { index: number; travel: number } | null = null;
    this.max.forEach((hi, i) => {
      if (used.has(i)) return;
      const travel = hi - this.min[i];
      if (!best || travel > best.travel) best = { index: i, travel };
    });
    return best;
  }

  private resetRange(): void {
    const axes = this.latest?.axes ?? [];
    this.min = [...axes];
    this.max = [...axes];
  }

  /** Accept the current step. Returns false (with `error`) if nothing usable moved. */
  next(): boolean {
    this.error = null;
    const pad = this.latest;
    if (!pad) {
      this.error = 'No input from the radio yet. Move a stick.';
      return false;
    }
    if (this.step === 'center') {
      this.rest = [...pad.axes];
      this.restButtons = pad.buttons.map((_, i) => button(pad, i));
    } else if (this.step === 'arm') {
      let best: SwitchCal | null = null;
      let delta = 0;
      const used = this.used();
      pad.axes.forEach((v, i) => {
        const d = Math.abs(v - (this.rest[i] ?? 0));
        if (!used.has(i) && d > delta) [best, delta] = [{ kind: 'axis', index: i, off: this.rest[i] ?? 0, on: v }, d];
      });
      pad.buttons.forEach((_, i) => {
        const v = button(pad, i);
        const d = Math.abs(v - (this.restButtons[i] ?? 0));
        if (d > delta) [best, delta] = [{ kind: 'button', index: i, off: this.restButtons[i] ?? 0, on: v }, d];
      });
      if (!best || delta < RADIO.detectTravel) {
        this.error = 'No switch moved. Flip the arm switch ON, or press Skip.';
        return false;
      }
      this.result.arm = best;
    } else if (this.step !== 'done') {
      const pick = this.pickAxis();
      if (!pick || pick.travel < RADIO.detectTravel * 2) {
        this.error = 'That stick did not move far enough. Sweep it end to end, then hold it.';
        return false;
      }
      const i = pick.index;
      const min = this.min[i];
      const max = this.max[i];
      const held = pad.axes[i];
      const invert = held < (min + max) / 2;
      const center = this.step === 'throttle' ? (min + max) / 2 : (this.rest[i] ?? (min + max) / 2);
      this.result[this.step] = { index: i, min, max, center, invert };
    }
    this.advance();
    return true;
  }

  /** Skip the arm switch (arm from R1 / Space instead). */
  skip(): void {
    if (this.step !== 'arm') return;
    this.result.arm = null;
    this.advance();
  }

  private advance(): void {
    this.step = CAL_STEPS[CAL_STEPS.indexOf(this.step) + 1] ?? 'done';
    this.resetRange();
  }

  get calibration(): RadioCalibration | null {
    const r = this.result;
    if (this.step !== 'done' || !r.throttle || !r.yaw || !r.pitch || !r.roll) return null;
    return { id: this.id, throttle: r.throttle, yaw: r.yaw, pitch: r.pitch, roll: r.roll, arm: r.arm ?? null };
  }
}

/** 0..1 across the calibrated endpoints. */
export function unitAxis(v: number, c: AxisCal): number {
  const t = Math.max(0, Math.min(1, (v - c.min) / (c.max - c.min || 1)));
  return c.invert ? 1 - t : t;
}

/** −1..1 around the calibrated centre, each side scaled to its own endpoint. */
export function centeredAxis(v: number, c: AxisCal, deadzone: number = RADIO.deadzone): number {
  const d = v - c.center;
  const span = d >= 0 ? c.max - c.center : c.center - c.min;
  let t = Math.max(-1, Math.min(1, d / (span || 1)));
  if (Math.abs(t) < deadzone) t = 0;
  return c.invert ? -t : t;
}

export function switchOn(pad: PadSnapshot, s: SwitchCal): boolean {
  const v = s.kind === 'axis' ? (pad.axes[s.index] ?? s.off) : button(pad, s.index);
  return Math.abs(v - s.on) < Math.abs(v - s.off);
}

/** Calibrations per device id, in localStorage (wrapped: storage may be blocked). */
export const calibrationStore = {
  load(id: string): RadioCalibration | null {
    try {
      const all = JSON.parse(localStorage.getItem(RADIO.storageKey) ?? '{}') as Record<string, RadioCalibration>;
      return all[id] ?? null;
    } catch {
      return null;
    }
  },
  save(cal: RadioCalibration): void {
    try {
      const all = JSON.parse(localStorage.getItem(RADIO.storageKey) ?? '{}') as Record<string, RadioCalibration>;
      all[cal.id] = cal;
      localStorage.setItem(RADIO.storageKey, JSON.stringify(all));
    } catch {
      // Private mode or blocked storage: the calibration lasts for this session only.
    }
  },
};

/**
 * A USB RC radio in joystick mode (EdgeTX/OpenTX HID): a non-standard gamepad. Needs a
 * calibration (wizard) before its sticks count; the arm switch is level-triggered, so flipping
 * it on arms (or is refused, like Betaflight) and flipping it off disarms.
 */
export class RadioInput {
  calibration: RadioCalibration | null;
  private armWas: boolean | null = null;
  last: PadSnapshot | null = null;

  constructor(
    readonly id: string,
    calibration: RadioCalibration | null = calibrationStore.load(id),
  ) {
    this.calibration = calibration;
  }

  get name(): string {
    return id2name(this.id);
  }

  poll(pad: PadSnapshot): DeviceFrame {
    this.last = pad;
    const c = this.calibration;
    const frame: DeviceFrame = {
      throttle: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
      arm: false,
      kill: false,
      actions: [],
      active: false,
    };
    if (!c) return frame;
    const ax = (a: AxisCal) => pad.axes[a.index] ?? a.center;
    frame.throttle = unitAxis(ax(c.throttle), c.throttle);
    frame.yaw = centeredAxis(ax(c.yaw), c.yaw);
    frame.pitch = centeredAxis(ax(c.pitch), c.pitch);
    frame.roll = centeredAxis(ax(c.roll), c.roll);
    frame.active = frame.throttle > 0.02 || [frame.yaw, frame.pitch, frame.roll].some((v) => Math.abs(v) > 0.2);
    if (c.arm) {
      const on = switchOn(pad, c.arm);
      frame.arm = on;
      // First poll just records the switch; a radio plugged in with the switch on must not arm.
      if (this.armWas !== null && on !== this.armWas) {
        frame.actions.push((on ? 'arm' : 'disarm') as InputAction);
        frame.active = true;
      }
      this.armWas = on;
    }
    return frame;
  }
}

const id2name = (id: string) => id.replace(/\s*\(.*\)\s*$/, '').trim() || 'RC radio';
