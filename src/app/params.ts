import type { CameraMode, FeedStyle } from '../config/cameras';
import type { BackgroundMode, QualityPreset } from '../config/render';

/**
 * URL overrides for testing and screenshots, e.g. `?quality=high&dynres=0&bg=hdri&rpm=1500&arrows=1&cam=fpv&feed=digital`.
 * `rpm` spins the props on the bench until the motor model lands (Task 4).
 */
export interface AppParams {
  quality: QualityPreset | null;
  dynamicResolution: boolean;
  background: BackgroundMode | null;
  rpm: number | null;
  spinArrows: boolean;
  camera: CameraMode | null;
  feed: FeedStyle | null;
}

const PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high', 'ultra'];
const BACKGROUNDS: readonly BackgroundMode[] = ['gradient', 'hdri'];
const CAMERA_MODES: readonly CameraMode[] = ['orbit', 'fpv', 'hd'];
const FEEDS: readonly FeedStyle[] = ['analog', 'digital'];

export function readParams(search: string = window.location.search): AppParams {
  const p = new URLSearchParams(search);
  const q = p.get('quality') as QualityPreset | null;
  const bg = p.get('bg') as BackgroundMode | null;
  const rpm = Number(p.get('rpm'));
  const cam = p.get('cam') as CameraMode | null;
  const feed = p.get('feed') as FeedStyle | null;
  return {
    quality: q && PRESETS.includes(q) ? q : null,
    dynamicResolution: p.get('dynres') !== '0',
    background: bg && BACKGROUNDS.includes(bg) ? bg : null,
    rpm: p.has('rpm') && Number.isFinite(rpm) ? Math.max(0, rpm) : null,
    spinArrows: p.get('arrows') === '1',
    camera: cam && CAMERA_MODES.includes(cam) ? cam : null,
    feed: feed && FEEDS.includes(feed) ? feed : null,
  };
}
