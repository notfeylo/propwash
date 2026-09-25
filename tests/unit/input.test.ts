import { describe, expect, it } from 'vitest';
import { GAMEPAD, PAD } from '../../src/config/input';
import { GamepadInput, padName, shapeAxis, shapeStick } from '../../src/input/GamepadInput';
import { InputManager } from '../../src/input/InputManager';
import { centeredAxis, RadioCalibrator, RadioInput, unitAxis } from '../../src/input/RadioInput';
import type { PadSnapshot } from '../../src/input/types';

const DS4 = 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)';

function pad(
  over: { axes?: number[]; pressed?: number[]; values?: Record<number, number> } = {},
  id = DS4,
  mapping = 'standard',
): PadSnapshot {
  const buttons = Array.from({ length: 18 }, (_, i) => {
    const value = over.values?.[i] ?? (over.pressed?.includes(i) ? 1 : 0);
    return { pressed: value > 0.5 || !!over.pressed?.includes(i), value };
  });
  return { id, index: 0, mapping, connected: true, axes: over.axes ?? [0, 0, 0, 0], buttons };
}

const dt = 1 / 60;

describe('stick shaping', () => {
  it('has a deadzone, reaches full scale, and applies expo', () => {
    expect(shapeAxis(GAMEPAD.deadzone * 0.9)).toBe(0);
    expect(shapeAxis(1)).toBeCloseTo(1);
    expect(shapeAxis(-1)).toBeCloseTo(-1);
    const half = shapeAxis(0.5 + GAMEPAD.deadzone / 2);
    expect(half).toBeLessThan(0.5); // expo softens the centre
    expect(half).toBeGreaterThan(0.3);
  });

  it('uses a radial deadzone so diagonals keep their direction', () => {
    const [x, y] = shapeStick(0.6, 0.6);
    expect(x).toBeCloseTo(y);
    expect(shapeStick(0.05, 0.05)).toEqual([0, 0]);
  });
});

describe('padName', () => {
  it('recognizes PS4 and PS5 pads', () => {
    expect(padName(DS4)).toBe('DualShock 4');
    expect(padName('054c-05c4-Wireless Controller')).toBe('DualShock 4');
    expect(padName('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('DualSense');
    expect(padName('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('Xbox controller');
  });
});

describe('GamepadInput (PS4 bindings, PRD §4.7)', () => {
  it('R2 is the analog throttle when selected', () => {
    const g = new GamepadInput(DS4);
    g.throttleSource = 'trigger';
    expect(g.poll(pad(), dt).throttle).toBe(0);
    expect(g.poll(pad({ values: { [PAD.r2]: 1 } }), dt).throttle).toBeCloseTo(1);
    expect(g.poll(pad({ values: { [PAD.r2]: 0.51 } }), dt).throttle).toBeCloseTo(0.5, 1);
    expect(g.poll(pad({ values: { [PAD.r2]: 0.07 } }), dt).throttle).toBe(0); // finger resting on R2
  });

  it('R1 toggles arm on the press edge only; L1+R1 is kill', () => {
    const g = new GamepadInput(DS4);
    expect(g.poll(pad({ pressed: [PAD.r1] }), dt).actions).toEqual(['armToggle']);
    expect(g.poll(pad({ pressed: [PAD.r1] }), dt).actions).toEqual([]); // held
    g.poll(pad(), dt);
    g.poll(pad({ pressed: [PAD.l1] }), dt);
    const f = g.poll(pad({ pressed: [PAD.l1, PAD.r1] }), dt);
    expect(f.actions).toEqual(['kill']);
    expect(f.kill).toBe(true);
    g.poll(pad(), dt);
    g.poll(pad({ pressed: [PAD.r1] }), dt);
    expect(g.poll(pad({ pressed: [PAD.r1, PAD.l1] }), dt).actions).toEqual(['kill']); // either order
  });

  it('Options must be held 0.6 s to plug or unplug, once per hold', () => {
    const g = new GamepadInput(DS4);
    const opts = pad({ pressed: [PAD.options] });
    let fired = 0;
    for (let t = 0; t < 0.55; t += dt) fired += g.poll(opts, dt).actions.length;
    expect(fired).toBe(0);
    for (let t = 0; t < 0.5; t += dt) fired += g.poll(opts, dt).actions.filter((a) => a === 'plugToggle').length;
    expect(fired).toBe(1);
    g.poll(pad(), dt);
    for (let t = 0; t < 0.2; t += dt) fired += g.poll(opts, dt).actions.length;
    expect(fired).toBe(1); // a tap doesn't
  });

  it('face buttons, touchpad and Share map to their actions', () => {
    const g = new GamepadInput(DS4);
    const f = g.poll(pad({ pressed: [PAD.triangle, PAD.square, PAD.circle, PAD.touchpad, PAD.share] }), dt);
    expect(f.actions).toEqual(['cameraCycle', 'feedCycle', 'beaconToggle', 'motorTest', 'payloadToggle']);
  });

  it('Mode 2 sticks: LX yaw, RY pitch (forward = +), RX roll', () => {
    const g = new GamepadInput(DS4);
    const f = g.poll(pad({ axes: [1, 0, -1, -1] }), dt);
    expect(f.yaw).toBeCloseTo(1);
    expect(f.roll).toBeCloseTo(-1);
    expect(f.pitch).toBeCloseTo(1);
  });

  it('stick throttle maps bottom → top to 0 → 1, or accumulates in hold mode', () => {
    const g = new GamepadInput(DS4);
    g.throttleSource = 'stick';
    expect(g.poll(pad({ axes: [0, 1, 0, 0] }), dt).throttle).toBe(0);
    expect(g.poll(pad({ axes: [0, -1, 0, 0] }), dt).throttle).toBe(1);
    g.throttleHold = true;
    let t = 0;
    for (let i = 0; i < 30; i++) t = g.poll(pad({ axes: [0, -1, 0, 0] }), dt).throttle;
    expect(t).toBeCloseTo(GAMEPAD.throttleHoldRate * 0.5, 2);
    expect(g.poll(pad(), dt).throttle).toBeCloseTo(t, 5); // stick released: holds
  });
});

describe('RC radio calibration (simulated, PRD §4.7 / §4.9)', () => {
  // A radio whose channels come in on odd axes, with throttle and pitch inverted.
  const RADIO = 'OpenTX Radiomaster TX16S Joystick (Vendor: 1209 Product: 4f54)';
  const radio = (a: Partial<Record<number, number>>, b: number[] = []) =>
    pad({ axes: [0, 0, 0, 0, 0, 0, 0].map((v, i) => a[i] ?? v), pressed: b }, RADIO, '');
  // Channel layout: A2 throttle (inverted: top = −1), A0 yaw, A5 pitch (inverted), A1 roll, A6 arm switch.
  const rest = { 2: 1, 6: -1 };

  function sweep(cal: RadioCalibrator, axis: number, hold: number) {
    for (const v of [0, 1, -1, 0, hold]) cal.sample(radio({ ...rest, [axis]: v }));
  }

  it('detects axes, endpoints, inversion and the arm switch', () => {
    const cal = new RadioCalibrator(RADIO);
    cal.sample(radio(rest));
    expect(cal.next()).toBe(true); // centre
    expect(cal.step).toBe('throttle');
    for (const v of [1, 0, -1, 1, -1]) cal.sample(radio({ ...rest, 2: v }));
    expect(cal.next()).toBe(true);
    sweep(cal, 0, 1);
    cal.next();
    sweep(cal, 5, -1);
    cal.next();
    sweep(cal, 1, 1);
    cal.next();
    expect(cal.step).toBe('arm');
    cal.sample(radio({ 2: 1, 6: 1 }));
    expect(cal.next()).toBe(true);
    const c = cal.calibration!;
    expect(c.throttle).toMatchObject({ index: 2, invert: true });
    expect(c.yaw).toMatchObject({ index: 0, invert: false });
    expect(c.pitch).toMatchObject({ index: 5, invert: true });
    expect(c.roll).toMatchObject({ index: 1, invert: false });
    expect(c.arm).toMatchObject({ kind: 'axis', index: 6 });

    // Apply it: throttle low at +1, top at −1; pitch forward at −1.
    expect(unitAxis(1, c.throttle)).toBe(0);
    expect(unitAxis(-1, c.throttle)).toBe(1);
    expect(centeredAxis(-1, c.pitch)).toBe(1);
    expect(centeredAxis(0, c.yaw)).toBe(0);

    const r = new RadioInput(RADIO, c);
    expect(r.poll(radio({ 2: 1, 6: -1 })).actions).toEqual([]); // first poll only records the switch
    expect(r.poll(radio({ 2: 1, 6: 1 })).actions).toEqual(['arm']);
    expect(r.poll(radio({ 2: 1, 6: 1 })).actions).toEqual([]);
    const off = r.poll(radio({ 2: 0, 6: -1 }));
    expect(off.actions).toEqual(['disarm']);
    expect(off.throttle).toBeCloseTo(0.5);
  });

  it('refuses a step when nothing moved far enough, and can skip the arm switch', () => {
    const cal = new RadioCalibrator(RADIO);
    cal.sample(radio(rest));
    cal.next();
    cal.sample(radio({ ...rest, 2: 0.9 }));
    expect(cal.next()).toBe(false);
    expect(cal.error).toMatch(/did not move/);
    for (const [ax, hold] of [
      [2, -1],
      [0, 1],
      [5, 1],
      [1, 1],
    ]) {
      sweep(cal, ax, hold);
      cal.next();
    }
    cal.skip();
    expect(cal.calibration?.arm).toBeNull();
  });

  it('a radio plugged in with the arm switch on does not arm', () => {
    const r = new RadioInput(RADIO, {
      id: RADIO,
      throttle: { index: 2, min: -1, max: 1, center: 0, invert: false },
      yaw: { index: 0, min: -1, max: 1, center: 0, invert: false },
      pitch: { index: 5, min: -1, max: 1, center: 0, invert: false },
      roll: { index: 1, min: -1, max: 1, center: 0, invert: false },
      arm: { kind: 'button', index: 3, off: 0, on: 1 },
    });
    expect(r.poll(radio({}, [3])).actions).toEqual([]);
    expect(r.poll(radio({}, [])).actions).toEqual(['disarm']);
  });
});

describe('InputManager', () => {
  it('takes throttle from the device used last and merges actions', () => {
    let pads: PadSnapshot[] = [];
    const target = new EventTarget() as unknown as Window;
    const m = new InputManager(target, () => pads);
    m.throttleSource = 'trigger';
    expect(m.poll(dt).device).toBe('keyboard');
    pads = [pad({ values: { [PAD.r2]: 0.8 }, pressed: [PAD.triangle] })];
    const s = m.poll(dt);
    expect(s.device).toBe('gamepad');
    expect(s.deviceName).toBe('DualShock 4');
    expect(s.throttle).toBeCloseTo(0.8, 1);
    expect(s.actions).toEqual(['cameraCycle']);
    pads = [];
    expect(m.poll(dt).device).toBe('keyboard'); // unplugged: back to the keyboard
  });

  it('ignores the duplicate of a press from a remapper virtual pad', () => {
    let pads: PadSnapshot[] = [];
    const target = new EventTarget() as unknown as Window;
    const m = new InputManager(target, () => pads);
    const xbox = (pressed: number[]) => ({
      ...pad({ pressed }, 'Xbox 360 Controller (XInput STANDARD GAMEPAD)'),
      index: 1,
    });
    pads = [pad(), xbox([])];
    m.poll(dt);
    pads = [pad({ pressed: [PAD.r1] }), xbox([])];
    expect(m.poll(dt).actions).toEqual(['armToggle']);
    pads = [pad({ pressed: [PAD.r1] }), xbox([PAD.r1])]; // the virtual pad, one frame late
    expect(m.poll(dt).actions).toEqual([]);
    pads = [pad(), xbox([])];
    for (let i = 0; i < 30; i++) m.poll(dt);
    pads = [pad(), xbox([PAD.r1])]; // a real, later press on the other pad counts
    expect(m.poll(dt).actions).toEqual(['armToggle']);
  });

  it('ignores racing wheels instead of offering radio calibration', () => {
    const target = new EventTarget() as unknown as Window;
    const wheel = pad({}, 'G920 Driving Force Racing Wheel for Xbox One (Vendor: 046d Product: c262)', '');
    const m = new InputManager(target, () => [{ ...wheel, index: 1 }, pad()]);
    m.poll(dt);
    expect(m.uncalibratedRadios.length).toBe(0);
    expect([...m.pads.keys()]).toEqual([0]);
  });

  it('treats non-standard pads as radios that need calibration', () => {
    const target = new EventTarget() as unknown as Window;
    const m = new InputManager(target, () => [pad({}, 'Some RC Joystick', '')]);
    m.poll(dt);
    expect(m.uncalibratedRadios.length).toBe(1);
  });
});

describe('Haptics', () => {
  it('sends a strong pulse once, then resumes the weak rumble', async () => {
    const { Haptics } = await import('../../src/input/Haptics');
    const calls: Record<string, number>[] = [];
    const p = {
      ...pad(),
      vibrationActuator: {
        playEffect: (_: string, e: Record<string, number>) => (calls.push(e), Promise.resolve('complete')),
      },
    };
    const h = new Haptics();
    h.pulse(0, 300);
    for (let t = 0; t <= 600; t += 16) h.update(p, t, 0.5);
    const strong = calls.filter((c) => c.strongMagnitude > 0);
    expect(strong.length).toBe(1);
    expect(strong[0].duration).toBe(300);
    expect(calls.at(-1)!.weakMagnitude).toBeGreaterThan(0);
  });
});
