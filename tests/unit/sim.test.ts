import { describe, expect, it } from 'vitest';
import { ARMING, BATTERY, MOTOR, POWER } from '../../src/config/motor';
import { Battery, ocvPerCell } from '../../src/sim/Battery';
import { Motor, mulberry32, targetRpm } from '../../src/sim/MotorModel';
import { PowerStateMachine } from '../../src/sim/PowerStateMachine';
import { Powertrain } from '../../src/sim/Powertrain';

const FULL_V = BATTERY.cells * 4.2;
const H = 1 / MOTOR.substepHz;

/** Drive one motor for `seconds` toward `target`, returning the RPM trace at each substep. */
function run(m: Motor, seconds: number, target: number, t0 = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.round(seconds / H); i++) {
    m.step(H, t0 + i * H, target);
    out.push(m.rpm);
  }
  return out;
}

describe('targetRpm (PRD §4.4)', () => {
  it('is idle at zero throttle and 0.75·KV·V at full', () => {
    expect(targetRpm(0, FULL_V)).toBe(MOTOR.rpmIdle);
    expect(targetRpm(1, FULL_V)).toBeCloseTo(0.75 * 1300 * 25.2, 6);
    expect(targetRpm(1, FULL_V)).toBeCloseTo(24570, 0);
  });

  it('drops the ceiling as the battery sags', () => {
    expect(targetRpm(1, 22)).toBeLessThan(targetRpm(1, FULL_V));
  });

  it('is monotonic in throttle', () => {
    for (let t = 0; t < 1; t += 0.01) expect(targetRpm(t + 0.01, FULL_V)).toBeGreaterThan(targetRpm(t, FULL_V));
  });
});

describe('Motor dynamics', () => {
  it('spools up with τup ≈ 60 ms', () => {
    const m = new Motor(0, () => 0.5); // zero offset, noise phase fixed
    m.drive = 'driven';
    const trace = run(m, 1, 20000);
    const final = trace[trace.length - 1];
    // First-order: 63% at τ; the overshoot spring adds a little delay.
    const at = trace[Math.round(MOTOR.tauUp / H)] / final;
    expect(at).toBeGreaterThan(0.5);
    expect(at).toBeLessThan(0.7);
    expect(Math.abs(final - 20000) / 20000).toBeLessThan(0.01);
  });

  it('spools down more slowly (τdown ≈ 120 ms) while driven', () => {
    const m = new Motor(0, () => 0.5);
    m.drive = 'driven';
    run(m, 1, 20000);
    const trace = run(m, 1, 2400, 1);
    const drop = (20000 - trace[Math.round(MOTOR.tauDown / H)]) / (20000 - 2400);
    expect(drop).toBeGreaterThan(0.5);
    expect(drop).toBeLessThan(0.7);
  });

  it('overshoots a little on a throttle snap, not on a slow sweep', () => {
    const snap = new Motor(0, () => 0.5);
    snap.drive = 'driven';
    run(snap, 0.5, 2400);
    const up = run(snap, 0.6, 24000, 0.5);
    const over = (Math.max(...up) - 24000 * snap.variance(0.5)) / 24000;
    expect(over).toBeGreaterThan(0.002);
    expect(over).toBeLessThan(0.06);

    const slow = new Motor(0, () => 0.5);
    slow.drive = 'driven';
    run(slow, 0.5, 2400);
    let peak = 0;
    for (let i = 0; i < 2000; i++) {
      const target = 2400 + (24000 - 2400) * Math.min(1, i / 1500);
      slow.step(H, 0.5 + i * H, target);
      peak = Math.max(peak, slow.rpm / target);
    }
    expect(peak).toBeLessThan(1.012); // variance only (±1%), no ringing
  });

  it('coasts down unpowered with τcoast ≈ 0.9 s to a full stop', () => {
    const m = new Motor(0, () => 0.5);
    m.drive = 'driven';
    run(m, 1, 20000);
    const start = m.rpm;
    m.drive = 'coast';
    const trace = run(m, 8, 0, 1);
    expect(trace[Math.round(MOTOR.tauCoast / H)] / start).toBeCloseTo(Math.exp(-1), 1);
    expect(trace[trace.length - 1]).toBe(0);
  });

  it('holds per-motor variance within ±1% and motors never match exactly', () => {
    const motors = [0, 1, 2, 3].map((i) => new Motor(i, mulberry32(42 + i)));
    const means = motors.map((m) => {
      m.drive = 'driven';
      const trace = run(m, 3, 11000).slice(1000);
      for (const r of trace) expect(Math.abs(r / 11000 - 1)).toBeLessThan(0.0105);
      return trace.reduce((s, r) => s + r, 0) / trace.length;
    });
    expect(new Set(means.map((x) => x.toFixed(1))).size).toBe(4);
  });
});

describe('PowerStateMachine (PRD §4.4)', () => {
  const tick = (p: PowerStateMachine, seconds: number, throttle = 0) => {
    const events = [];
    for (let t = 0; t < seconds; t += 0.01) events.push(...p.update(0.01, { throttle }));
    return events.map((e) => e.type);
  };

  it('boots: plug tick → ESC tones → signal tones → DISARMED at ≈1.2 s', () => {
    const p = new PowerStateMachine();
    p.plug();
    expect(p.state).toBe('BOOTING');
    const events = tick(p, POWER.bootDurationS - 0.05);
    expect(events).toEqual(['plugged', 'escPowerOnTones', 'escSignalTones']);
    expect(p.state).toBe('BOOTING');
    expect(tick(p, 0.1)).toEqual(['ready']);
    expect(p.state).toBe('DISARMED');
  });

  it('refuses to arm with throttle above 5% and flags THROTTLE until the stick drops', () => {
    const p = new PowerStateMachine();
    p.plug();
    tick(p, 2);
    expect(p.arm({ throttle: 0.2 })).toBe(false);
    expect(p.state).toBe('DISARMED');
    expect(p.warning).toBe('THROTTLE');
    expect(tick(p, 0.1, 0.2)).toEqual(['armRefused']);
    expect(p.warning).toBe('THROTTLE');
    tick(p, 0.05, 0);
    expect(p.warning).toBeNull();
  });

  it('refuses while booting or unpowered', () => {
    const p = new PowerStateMachine();
    expect(p.arm({ throttle: 0 })).toBe(false);
    expect(p.warning).toBe('NO POWER');
    p.plug();
    expect(p.arm({ throttle: 0 })).toBe(false);
    expect(p.warning).toBe('BOOTING');
  });

  it('arms at zero throttle, spins with throttle, disarms and kills', () => {
    const p = new PowerStateMachine();
    p.plug();
    tick(p, 2);
    expect(p.arm({ throttle: ARMING.maxThrottle })).toBe(true);
    expect(p.state).toBe('ARMED');
    tick(p, 0.1, 0.4);
    expect(p.state).toBe('SPINNING');
    tick(p, 0.1, 0);
    expect(p.state).toBe('ARMED');
    p.disarm();
    expect(p.state).toBe('DISARMED');
    p.arm({ throttle: 0 });
    p.disarm('kill');
    expect(tick(p, 0.01)).toEqual(['disarmed', 'armed', 'disarmed']);
  });

  it('unplugs from any state to OFF', () => {
    const p = new PowerStateMachine();
    p.plug();
    tick(p, 2);
    p.arm({ throttle: 0 });
    p.unplug();
    expect(p.state).toBe('OFF');
    expect(p.armed).toBe(false);
  });

  it('allows the beacon only while disarmed, and arming turns it off', () => {
    const p = new PowerStateMachine();
    p.setBeacon(true);
    expect(p.beacon).toBe(false);
    p.plug();
    tick(p, 2);
    p.setBeacon(true);
    expect(p.beacon).toBe(true);
    p.arm({ throttle: 0 });
    expect(p.beacon).toBe(false);
  });
});

describe('Battery', () => {
  it('rests at 4.2 V/cell full and follows the OCV curve', () => {
    expect(new Battery(true).voltage).toBeCloseTo(FULL_V, 6);
    expect(ocvPerCell(0.5)).toBeCloseTo(3.75, 6);
    expect(ocvPerCell(0)).toBeCloseTo(3.0, 6);
  });

  it('sags under load and counts mAh', () => {
    const b = new Battery(true);
    const full = targetRpm(1, FULL_V);
    for (let i = 0; i < 100; i++) b.update(0.01, [full, full, full, full], true);
    expect(b.current).toBeGreaterThan(80);
    expect(b.current).toBeLessThan(100);
    expect(FULL_V - b.voltage).toBeGreaterThan(2);
    expect(b.usedMah).toBeCloseTo((b.current * 1) / 3.6, 0);
  });

  it('draws ≈8 A at hover', () => {
    expect(Battery.motorCurrent([11000, 11000, 11000, 11000]) + BATTERY.baseCurrentA).toBeCloseTo(8.6, 0);
  });

  it('warns only after low voltage persists', () => {
    const b = new Battery(true, 0.02);
    b.update(0.01, [0, 0, 0, 0], false);
    expect(b.lowWarning).toBe(false);
    for (let i = 0; i < (BATTERY.warnHoldS + 0.5) * 100; i++) b.update(0.01, [0, 0, 0, 0], false);
    expect(b.lowWarning).toBe(true);
  });
});

describe('Powertrain', () => {
  const setup = () => {
    const pt = new Powertrain(7, mulberry32(3));
    pt.togglePlug();
    for (let i = 0; i < 150; i++) pt.update(0.01);
    return pt;
  };

  it('arming at zero throttle brings every rotor smoothly to idle', () => {
    const pt = setup();
    expect(pt.arm()).toBe(true);
    const traces: number[][] = [[], [], [], []];
    for (let i = 0; i < 60; i++) {
      pt.update(1 / 120);
      pt.rpms.forEach((r, k) => traces[k].push(r));
    }
    for (const tr of traces) {
      const final = tr[tr.length - 1];
      expect(Math.abs(final / MOTOR.rpmIdle - 1)).toBeLessThan(0.02);
      expect(Math.max(...tr) / final).toBeLessThan(1.03); // no bang to idle
      for (let i = 1; i < tr.length; i++) expect(tr[i] - tr[i - 1]).toBeGreaterThan(-60); // no dips
    }
    // Stagger: rotors don't all leave zero on the same substep.
    const firstMove = traces.map((tr) => tr.findIndex((r) => r > 50));
    expect(new Set(firstMove).size).toBeGreaterThan(1);
  });

  it('disarm at high RPM coasts down over about a second', () => {
    const pt = setup();
    pt.arm();
    pt.throttle = 1;
    for (let i = 0; i < 100; i++) pt.update(0.01);
    const start = pt.rpms[0];
    pt.disarm();
    for (let i = 0; i < 100; i++) pt.update(0.01);
    const after1s = pt.rpms[0] / start;
    expect(after1s).toBeGreaterThan(0.25);
    expect(after1s).toBeLessThan(0.45);
    for (let i = 0; i < 800; i++) pt.update(0.01);
    expect(pt.rpms.every((r) => r === 0)).toBe(true);
  });

  it('unplugging while spinning cuts power and the props coast', () => {
    const pt = setup();
    pt.arm();
    pt.throttle = 0.5;
    for (let i = 0; i < 50; i++) pt.update(0.01);
    pt.togglePlug();
    const before = pt.rpms[0];
    pt.update(0.05);
    expect(pt.power.state).toBe('OFF');
    expect(pt.rpms[0]).toBeGreaterThan(0.8 * before);
    expect(pt.rpms[0]).toBeLessThan(before);
  });
});
