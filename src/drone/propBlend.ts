import { PROP_BLEND } from '../config/drone';

export interface PropWeights {
  /** Opacity of the real blades. */
  mesh: number;
  /** Total weight of the sub-frame smear ghosts. */
  smear: number;
  /** Opacity scale of the blur disc. */
  disc: number;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Stage weights for a given |rpm| (PRD §4.3). Continuous in rpm, so no popping. */
export function propWeights(rpm: number, cfg = PROP_BLEND): PropWeights {
  const r = Math.abs(rpm);
  return {
    mesh: 1 - smoothstep(cfg.meshFade[0], cfg.meshFade[1], r),
    smear: smoothstep(cfg.smearIn[0], cfg.smearIn[1], r) * (1 - smoothstep(cfg.smearOut[0], cfg.smearOut[1], r)),
    disc: smoothstep(cfg.discIn[0], cfg.discIn[1], r),
  };
}

const TAU = Math.PI * 2;

/** Wrap an angle to [0, 2π). */
export const wrapAngle = (a: number) => ((a % TAU) + TAU) % TAU;

/**
 * Apparent per-frame rotation of an n-blade prop sampled at the frame rate: the true step
 * folded into (−period/2, period/2], period = 2π / n. This is the strobed "wagon wheel" motion.
 */
export function aliasedStep(step: number, blades: number): number {
  const period = TAU / blades;
  const s = (((step + period / 2) % period) + period) % period;
  return s - period / 2;
}
