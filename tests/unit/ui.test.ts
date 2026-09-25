import { describe, expect, it } from 'vitest';
import { defaultSettings, mergeSettings } from '../../src/app/settings';
import { Powertrain } from '../../src/sim/Powertrain';

const run = (pt: Powertrain, s: number) => {
  for (let t = 0; t < s; t += 1 / 60) pt.update(1 / 60);
};

describe('motor test (PRD §4.8)', () => {
  it('spins each motor from its slider only while powered and disarmed', () => {
    const pt = new Powertrain(7, () => 0.5);
    pt.motorTest.enabled = true;
    pt.motorTest.values.splice(0, 4, 0, 0.5, 0.2, 0);
    run(pt, 0.5);
    expect(pt.rpms.every((r) => r === 0)).toBe(true); // unplugged
    pt.togglePlug();
    run(pt, 2);
    const [m1, m2, m3, m4] = pt.rpms;
    expect(m1).toBe(0); // 0% is stopped, not idle
    expect(m4).toBe(0);
    expect(m2).toBeGreaterThan(m3);
    expect(m3).toBeGreaterThan(3000);
    expect(pt.driven).toBe(true);
    expect(pt.power.armed).toBe(false);
  });

  it('blocks arming while the test is on, and coasts when it is closed', () => {
    const pt = new Powertrain(7, () => 0.5);
    pt.togglePlug();
    run(pt, 2);
    pt.motorTest.enabled = true;
    pt.motorTest.values.fill(0.4);
    expect(pt.arm()).toBe(false);
    run(pt, 1);
    const spinning = pt.rpms[0];
    pt.setMotorTest(false);
    run(pt, 0.3);
    expect(pt.rpms[0]).toBeLessThan(spinning);
    expect(pt.rpms[0]).toBeGreaterThan(0); // coasting, not braked
    expect(pt.arm()).toBe(true);
  });
});

describe('settings', () => {
  it('merges stored values over defaults and drops junk', () => {
    const s = mergeSettings({
      volume: 0.3,
      uptiltDeg: 'high',
      layers: { B: 0.5, Z: 9, C: 99 },
      keys: { armToggle: ['KeyJ'], bogus: ['KeyQ'], kill: [3] },
      extra: true,
    });
    const d = defaultSettings();
    expect(s.volume).toBe(0.3);
    expect(s.uptiltDeg).toBe(d.uptiltDeg);
    expect(s.layers.B).toBe(0.5);
    expect(s.layers.C).toBe(2); // clamped
    expect('Z' in s.layers).toBe(false);
    expect(s.keys.armToggle).toEqual(['KeyJ']);
    expect(s.keys.kill).toEqual(d.keys.kill);
    expect('extra' in s).toBe(false);
    expect(mergeSettings(null)).toEqual(d);
  });
});
