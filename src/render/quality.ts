import { DYNAMIC_RESOLUTION, QUALITY_AUTO, type QualityPreset } from '../config/render';

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Pick a preset from the median frame time of the first measured frames. */
export function pickPreset(medianMs: number): QualityPreset {
  if (medianMs > QUALITY_AUTO.lowAboveMs) return 'low';
  if (medianMs > QUALITY_AUTO.mediumAboveMs) return 'medium';
  if (medianMs < QUALITY_AUTO.ultraBelowMs) return 'ultra';
  return 'high';
}

export interface QualityControllerOptions {
  /** Fixed preset (URL/settings override). When set, auto-pick is skipped. */
  forced: QualityPreset | null;
  dynamicResolution: boolean;
  onPreset(preset: QualityPreset): void;
  onScale(scale: number): void;
}

/**
 * Auto-picks the quality preset once from early frame times, then nudges a render-scale
 * factor up or down so frame time stays under budget.
 */
export class QualityController {
  preset: QualityPreset;
  scale = 1;
  private frame = 0;
  private samples: number[] = [];
  private window: number[] = [];
  private windowS = 0;
  private picked: boolean;

  constructor(private opts: QualityControllerOptions) {
    this.preset = opts.forced ?? QUALITY_AUTO.initial;
    this.picked = opts.forced !== null;
  }

  /** Settings: a fixed preset stops the auto-pick; null re-runs it from the next frames. */
  force(preset: QualityPreset | null): void {
    if (preset === null) {
      this.picked = false;
      this.frame = 0;
      this.samples = [];
      return;
    }
    this.picked = true;
    if (preset !== this.preset) {
      this.preset = preset;
      this.opts.onPreset(preset);
    }
  }

  update(dtS: number): void {
    const ms = dtS * 1000;
    this.frame++;
    if (!this.picked) {
      if (this.frame <= QUALITY_AUTO.warmupFrames) return;
      this.samples.push(ms);
      if (this.samples.length >= QUALITY_AUTO.sampleFrames) {
        this.picked = true;
        const next = pickPreset(median(this.samples));
        if (next !== this.preset) {
          this.preset = next;
          this.opts.onPreset(next);
        }
      }
      return;
    }
    if (!this.opts.dynamicResolution || !DYNAMIC_RESOLUTION.enabled) return;
    this.window.push(ms);
    this.windowS += dtS;
    if (this.windowS < DYNAMIC_RESOLUTION.intervalS) return;
    const m = median(this.window);
    this.window = [];
    this.windowS = 0;
    const { min, max, step, downAboveMs, upBelowMs } = DYNAMIC_RESOLUTION;
    let next = this.scale;
    if (m > downAboveMs) next = Math.max(min, this.scale - step);
    else if (m < upBelowMs) next = Math.min(max, this.scale + step);
    if (next !== this.scale) {
      this.scale = +next.toFixed(3);
      this.opts.onScale(this.scale);
    }
  }
}
