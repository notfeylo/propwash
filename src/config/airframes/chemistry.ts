import type { Chemistry } from './types';

/**
 * Open-circuit volts per cell vs state of charge (Phase 2 PRD §2.5), linear between points.
 * LiPo: a typical high-discharge pack. Li-ion: 21700 cells (same table as the Phase 1 bench pack).
 */
export const OCV_CURVES: Record<Chemistry, readonly (readonly [number, number])[]> = {
  lipo: [
    [0, 3.27],
    [0.05, 3.61],
    [0.1, 3.69],
    [0.2, 3.73],
    [0.3, 3.77],
    [0.4, 3.79],
    [0.5, 3.82],
    [0.6, 3.87],
    [0.7, 3.92],
    [0.8, 3.98],
    [0.9, 4.06],
    [1, 4.2],
  ],
  liion: [
    [0, 3.0],
    [0.05, 3.3],
    [0.1, 3.45],
    [0.3, 3.62],
    [0.5, 3.75],
    [0.7, 3.9],
    [0.9, 4.08],
    [1, 4.2],
  ],
};

/** Low-battery warning: loaded volts per cell held under this for `warnHoldS`. */
export const PACK_WARNING = { cellV: 3.5, holdS: 2 };
