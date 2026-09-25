import { describe, expect, it } from 'vitest';
import { AUDIO } from '../../src/config/audio';
import { DRONE } from '../../src/config/drone';
import { MOTOR } from '../../src/config/motor';
import { mulberry32 } from '../../src/sim/MotorModel';
import { buildCrossfadedLoop } from '../../src/audio/loopBuilder';
import {
  electricalHz,
  fundamentalHz,
  recordingWeight,
  transientStrength,
  voiceParams,
} from '../../src/audio/voiceMapping';

describe('buildCrossfadedLoop', () => {
  // A sine whose period doesn't divide the length: a naive loop would click at the seam.
  const sr = 8000;
  const src = Float32Array.from({ length: sr }, (_, i) => Math.sin((2 * Math.PI * 293.3 * i) / sr));
  const fade = Math.round(0.3 * sr);
  const out = buildCrossfadedLoop(src, fade);

  it('shortens the buffer by the fade length', () => {
    expect(out.length).toBe(src.length - fade);
  });

  it('wraps seamlessly: end → start continues the original signal', () => {
    // Last sample is src[N−F−1], first is src[N−F]: consecutive samples of the source.
    expect(out[out.length - 1]).toBeCloseTo(src[src.length - fade - 1], 6);
    expect(out[0]).toBeCloseTo(src[src.length - fade], 6);
    const maxStep = Math.max(...Array.from(out.subarray(1), (v, i) => Math.abs(v - out[i])));
    const seamStep = Math.abs(out[0] - out[out.length - 1]);
    expect(seamStep).toBeLessThanOrEqual(maxStep + 1e-6);
  });

  it('keeps level through the crossfade (equal power, uncorrelated ends)', () => {
    const rand = mulberry32(9);
    const noise = Float32Array.from({ length: 40000 }, () => rand() * 2 - 1);
    const looped = buildCrossfadedLoop(noise, 8000);
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    const body = rms(looped.subarray(10000, 30000));
    const seam = rms(looped.subarray(2000, 6000));
    expect(Math.abs(20 * Math.log10(seam / body))).toBeLessThan(1.5);
  });
});

describe('voice mapping (PRD §4.5)', () => {
  it('pitches every tonal layer from the recording reference', () => {
    expect(fundamentalHz(MOTOR.rpmHover)).toBeCloseTo(AUDIO.f0AtHoverHz, 6);
    expect(voiceParams(MOTOR.rpmHover, true).aRate).toBeCloseTo(1, 6);
    expect(voiceParams(MOTOR.rpmHover, true).bHz).toBeCloseTo(AUDIO.f0AtHoverHz, 6);
  });

  it('puts the whine at the electrical frequency (7 pole pairs)', () => {
    expect(electricalHz(6000)).toBeCloseTo(700, 6);
  });

  it('fades the recording out exactly where its playback rate clamps', () => {
    const { rateMin, rateMax } = AUDIO.layers.A;
    expect(recordingWeight(rateMin)).toBe(0);
    expect(recordingWeight(rateMax)).toBe(0);
    expect(recordingWeight(1)).toBe(1);
  });

  it('is silent at rest and without the recording has no layer A', () => {
    const p = voiceParams(0, true);
    expect(p.aGain + p.bGain + p.cGain + p.dGain).toBe(0);
    expect(voiceParams(MOTOR.rpmHover, false).aGain).toBe(0);
  });

  it('has no gain or pitch jumps anywhere from 0 to max RPM (both paths)', () => {
    for (const rec of [true, false]) {
      let prev = voiceParams(0, rec);
      for (let r = 5; r <= DRONE.rpmMax; r += 5) {
        const p = voiceParams(r, rec);
        for (const k of ['aGain', 'bGain', 'cGain', 'dGain'] as const)
          expect(Math.abs(p[k] - prev[k])).toBeLessThan(0.002);
        expect(p.bHz).toBeGreaterThan(prev.bHz);
        prev = p;
      }
    }
  });

  it('gets louder with RPM through the tonal body (above idle)', () => {
    const level = (r: number) => {
      const p = voiceParams(r, false);
      return p.bGain + p.dGain;
    };
    for (let r = 3500; r < 24000; r += 500) expect(level(r + 500)).toBeGreaterThan(level(r));
  });

  it('keeps the whine most audible (relative to the body) at low RPM', () => {
    const rel = (r: number) => {
      const p = voiceParams(r, false);
      return p.cGain / (p.bGain + p.dGain);
    };
    expect(rel(3000)).toBeGreaterThan(rel(11000) * 3);
  });
});

describe('transientStrength', () => {
  it('fires only above 25,000 RPM/s and saturates', () => {
    expect(transientStrength(20000)).toBe(0);
    expect(transientStrength(-20000)).toBe(0);
    expect(transientStrength(30000)).toBeGreaterThan(0);
    expect(transientStrength(-30000)).toBeGreaterThan(0);
    expect(transientStrength(1e7)).toBe(1);
  });

  it('is not triggered by the arm ramp (idle in 150 ms)', () => {
    // Smoothstep ramp peaks at 1.5× the mean slope.
    const peak = (1.5 * MOTOR.rpmIdle) / 0.15;
    expect(transientStrength(peak)).toBe(0);
  });
});
