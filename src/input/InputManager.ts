import { GamepadInput } from './GamepadInput';
import { Haptics } from './Haptics';
import { KeyboardInput } from './KeyboardInput';
import { RadioInput } from './RadioInput';
import { type ControlState, type DeviceFrame, type InputDevice, type PadSnapshot } from './types';

export type PadListener = (
  event: 'connected' | 'disconnected',
  device: { kind: InputDevice; name: string; index: number },
) => void;

const readPads = (): PadSnapshot[] => {
  try {
    return (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p && p.connected) as PadSnapshot[];
  } catch {
    return []; // blocked by a permissions policy
  }
};

/**
 * One normalized ControlState per frame from every device (PRD §4.7). Actions from all devices
 * apply; throttle and sticks come from the device used most recently. Standard-mapping pads
 * (PS4/PS5/Xbox in Chrome) are gamepads; anything else is treated as an RC radio.
 */
export class InputManager {
  readonly keyboard: KeyboardInput;
  readonly haptics = new Haptics();
  device: InputDevice = 'keyboard';
  deviceName = 'Keyboard';
  /** Gamepad index of the active pad or radio (−1 = keyboard). */
  activeIndex = -1;
  readonly pads = new Map<number, GamepadInput | RadioInput>();
  onDevice?: PadListener;
  private lastState: ControlState | null = null;

  constructor(
    target: Window = window,
    private getPads: () => PadSnapshot[] = readPads,
  ) {
    this.keyboard = new KeyboardInput(target);
  }

  /** The active device's raw snapshot, for haptics and the visualizer. */
  get activePad(): PadSnapshot | null {
    return this.pads.get(this.activeIndex)?.last ?? null;
  }

  get state(): ControlState | null {
    return this.lastState;
  }

  /** Radios connected without a calibration (the HUD offers the wizard). */
  get uncalibratedRadios(): RadioInput[] {
    return [...this.pads.values()].filter((p): p is RadioInput => p instanceof RadioInput && !p.calibration);
  }

  poll(dt: number): ControlState {
    const frames: { kind: InputDevice; name: string; index: number; f: DeviceFrame }[] = [];
    frames.push({ kind: 'keyboard', name: 'Keyboard', index: -1, f: this.keyboard.poll(dt) });

    const seen = new Set<number>();
    for (const pad of this.getPads()) {
      seen.add(pad.index);
      let dev = this.pads.get(pad.index);
      if (!dev || dev.id !== pad.id) {
        if (dev && this.activeIndex === pad.index) this.setActive('keyboard', 'Keyboard', -1);
        dev = pad.mapping === 'standard' ? new GamepadInput(pad.id) : new RadioInput(pad.id);
        this.pads.set(pad.index, dev);
        this.onDevice?.('connected', { kind: kindOf(dev), name: dev.name, index: pad.index });
      }
      const f = dev instanceof GamepadInput ? dev.poll(pad, dt) : dev.poll(pad);
      frames.push({ kind: kindOf(dev), name: dev.name, index: pad.index, f });
    }
    for (const [i, dev] of this.pads) {
      if (seen.has(i)) continue;
      this.pads.delete(i);
      this.onDevice?.('disconnected', { kind: kindOf(dev), name: dev.name, index: i });
      if (this.activeIndex === i) this.setActive('keyboard', 'Keyboard', -1);
    }

    for (const d of frames) if (d.f.active) this.setActive(d.kind, d.name, d.index);
    const src = frames.find((d) => d.index === this.activeIndex) ?? frames[0];
    const state: ControlState = {
      throttle: this.device === 'keyboard' ? this.keyboard.throttle : src.f.throttle,
      yaw: src.f.yaw,
      pitch: src.f.pitch,
      roll: src.f.roll,
      arm: src.f.arm,
      kill: frames.some((d) => d.f.kill),
      actions: frames.flatMap((d) => d.f.actions),
      device: this.device,
      deviceName: this.deviceName,
    };
    this.lastState = state;
    return state;
  }

  private setActive(kind: InputDevice, name: string, index: number): void {
    // Back on the keyboard, W/S pick up from the throttle the last device left.
    if (kind === 'keyboard' && this.device !== 'keyboard') this.keyboard.throttle = this.lastState?.throttle ?? 0;
    this.device = kind;
    this.deviceName = name;
    this.activeIndex = index;
  }
}

const kindOf = (d: GamepadInput | RadioInput): InputDevice => (d instanceof GamepadInput ? 'gamepad' : 'radio');
