import { BODY_BBOX_CENTER } from './common';
import type { Airframe } from './types';

/** 7″ freestyle: 6S 1300 mAh LiPo, no payload (Phase 2 PRD §2.1). */
export const freestyle7: Airframe = {
  id: 'freestyle7',
  label: '7″ freestyle (6S 1300 LiPo)',
  massKg: 0.85,
  inertia: { pitch: 0.0048, yaw: 0.0085, roll: 0.0045 },
  com: BODY_BBOX_CENTER,
  // PRD §2.1 gives 0.012 Ω/cell; a fresh high-C 1300 mAh pack measures ≈ 2 mΩ/cell, and only that
  // lets T5 (punch-out) and T9 (fresh-pack sag) pass together. See DECISIONS 2026-09-25.
  pack: { chemistry: 'lipo', series: 6, parallel: 1, capacityMah: 1300, rIntPerCellOhm: 0.002 },
  cdA: { front: 0.008, top: 0.02 },
  payload: false,
  reference: {
    thrustToWeight: 8.9,
    hoverRpm: 8200,
    hoverCmd: 0.26,
    hoverCmdBand: [0.24, 0.28],
    punchAccelG: [7, 9],
    punchSpeedMs: 40,
    punchClimbM: 60,
    topSpeedKmh: [130, 160],
  },
};
