import { describe, expect, it } from 'vitest';
import { QUALITY_AUTO } from '../../src/config/render';
import { pickPreset, QualityController } from '../../src/render/quality';

describe('pickPreset', () => {
  it('maps median frame time to a preset', () => {
    expect(pickPreset(QUALITY_AUTO.lowAboveMs + 1)).toBe('low');
    expect(pickPreset(QUALITY_AUTO.mediumAboveMs + 1)).toBe('medium');
    expect(pickPreset(16.7)).toBe('high');
    expect(pickPreset(QUALITY_AUTO.ultraBelowMs - 1)).toBe('ultra');
  });
});

describe('QualityController', () => {
  const run = (ms: number, frames: number, forced: 'low' | null = null) => {
    const picks: string[] = [];
    const scales: number[] = [];
    const q = new QualityController({
      forced,
      dynamicResolution: true,
      onPreset: (p) => picks.push(p),
      onScale: (s) => scales.push(s),
    });
    for (let i = 0; i < frames; i++) q.update(ms / 1000);
    return { q, picks, scales };
  };

  it('picks once after warm-up + sample frames', () => {
    const n = QUALITY_AUTO.warmupFrames + QUALITY_AUTO.sampleFrames;
    expect(run(40, n - 1).picks).toEqual([]);
    expect(run(40, n).picks).toEqual(['low']);
  });

  it('never auto-picks when a preset is forced', () => {
    const { q, picks } = run(40, 400, 'low');
    expect(picks).toEqual([]);
    expect(q.preset).toBe('low');
  });

  it('lowers the render scale when frames stay slow, within bounds', () => {
    const { q, scales } = run(25, 2000);
    expect(scales.length).toBeGreaterThan(0);
    expect(q.scale).toBeGreaterThanOrEqual(0.6);
    expect(scales.every((s, i) => i === 0 || s <= scales[i - 1])).toBe(true);
  });
});
