import type { BackgroundMode, QualityPreset } from '../config/render';

/** URL overrides, e.g. `?quality=high&dynres=0&bg=hdri`. Used for testing and screenshots. */
export interface AppParams {
  quality: QualityPreset | null;
  dynamicResolution: boolean;
  background: BackgroundMode | null;
}

const PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high', 'ultra'];
const BACKGROUNDS: readonly BackgroundMode[] = ['gradient', 'hdri'];

export function readParams(search: string = window.location.search): AppParams {
  const p = new URLSearchParams(search);
  const q = p.get('quality') as QualityPreset | null;
  const bg = p.get('bg') as BackgroundMode | null;
  return {
    quality: q && PRESETS.includes(q) ? q : null,
    dynamicResolution: p.get('dynres') !== '0',
    background: bg && BACKGROUNDS.includes(bg) ? bg : null,
  };
}
