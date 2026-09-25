import { describe, expect, it } from 'vitest';
import { PROP_BLEND } from '../../src/config/drone';
import { aliasedStep, propWeights, wrapAngle } from '../../src/drone/propBlend';

describe('propWeights', () => {
  it('shows only the real mesh below the smear threshold', () => {
    expect(propWeights(0)).toEqual({ mesh: 1, smear: 0, disc: 0 });
    expect(propWeights(PROP_BLEND.meshFade[0] - 1)).toEqual({ mesh: 1, smear: 0, disc: 0 });
  });

  it('shows only the disc well above the handoff', () => {
    const w = propWeights(11000);
    expect(w.mesh).toBe(0);
    expect(w.smear).toBe(0);
    expect(w.disc).toBe(1);
  });

  it('blends mesh + smear between 400 and 2500 RPM (PRD §4.3)', () => {
    const w = propWeights(1500);
    expect(w.mesh).toBeGreaterThan(0);
    expect(w.mesh).toBeLessThan(1);
    expect(w.smear).toBe(1);
  });

  it('is continuous: no weight jumps more than 1% per RPM step across 0–40k', () => {
    let prev = propWeights(0);
    for (let rpm = 1; rpm <= 40000; rpm++) {
      const w = propWeights(rpm);
      for (const k of ['mesh', 'smear', 'disc'] as const) expect(Math.abs(w[k] - prev[k])).toBeLessThan(0.01);
      prev = w;
    }
  });

  it('never leaves the prop without a visible layer', () => {
    for (let rpm = 0; rpm <= 40000; rpm += 10) {
      const w = propWeights(rpm);
      expect(w.mesh + w.smear + w.disc).toBeGreaterThan(0.9);
    }
  });

  it('treats direction symmetrically', () => {
    expect(propWeights(-1800)).toEqual(propWeights(1800));
  });
});

describe('aliasedStep', () => {
  const period = (2 * Math.PI) / 3;

  it('passes small steps through unchanged', () => {
    expect(aliasedStep(0.1, 3)).toBeCloseTo(0.1);
    expect(aliasedStep(-0.1, 3)).toBeCloseTo(-0.1);
  });

  it('folds whole blade periods away (wagon-wheel effect)', () => {
    expect(aliasedStep(period + 0.05, 3)).toBeCloseTo(0.05);
    expect(aliasedStep(5 * period - 0.05, 3)).toBeCloseTo(-0.05);
  });

  it('stays within half a blade period', () => {
    for (let s = -50; s <= 50; s += 0.37) expect(Math.abs(aliasedStep(s, 3))).toBeLessThanOrEqual(period / 2 + 1e-9);
  });
});

describe('wrapAngle', () => {
  it('wraps into [0, 2π)', () => {
    expect(wrapAngle(-0.5)).toBeCloseTo(2 * Math.PI - 0.5);
    expect(wrapAngle(7 * Math.PI)).toBeCloseTo(Math.PI);
  });
});
