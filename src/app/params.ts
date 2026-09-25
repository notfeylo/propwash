import type { BackgroundMode, QualityPreset } from '../config/render';

/**
 * URL overrides for testing and screenshots, e.g. `?quality=high&dynres=0&bg=hdri&rpm=1500&arrows=1`.
 * `rpm` spins the props on the bench until the motor model lands (Task 4).
 */
export interface AppParams {
  quality: QualityPreset | null;
  dynamicResolution: boolean;
  background: BackgroundMode | null;
  rpm: number | null;
  spinArrows: boolean;
}

const PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high', 'ultra'];
const BACKGROUNDS: readonly BackgroundMode[] = ['gradient', 'hdri'];

export function readParams(search: string = window.location.search): AppParams {
  const p = new URLSearchParams(search);
  const q = p.get('quality') as QualityPreset | null;
  const bg = p.get('bg') as BackgroundMode | null;
  const rpm = Number(p.get('rpm'));
  return {
    quality: q && PRESETS.includes(q) ? q : null,
    dynamicResolution: p.get('dynres') !== '0',
    background: bg && BACKGROUNDS.includes(bg) ? bg : null,
    rpm: p.has('rpm') && Number.isFinite(rpm) ? Math.max(0, rpm) : null,
    spinArrows: p.get('arrows') === '1',
  };
}
