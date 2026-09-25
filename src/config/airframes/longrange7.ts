import { BODY_BBOX_CENTER } from './common';
import type { Airframe } from './types';

/** 7″ long range: 6S2P 21700 Li-ion, 8000 mAh, no payload (Phase 2 PRD §2.1). */
export const longrange7: Airframe = {
  id: 'longrange7',
  label: '7″ long range (6S2P Li-ion)',
  massKg: 1.35,
  inertia: { pitch: 0.0079, yaw: 0.011, roll: 0.0075 },
  com: BODY_BBOX_CENTER,
  pack: { chemistry: 'liion', series: 6, parallel: 2, capacityMah: 8000, rIntPerCellOhm: 0.02 },
  cdA: { front: 0.01, top: 0.025 },
  payload: false,
  reference: {
    thrustToWeight: 5.6,
    hoverRpm: 10350,
    hoverCmd: 0.36,
    hoverCmdBand: [0.34, 0.38],
    punchAccelG: [4, 5],
    punchSpeedMs: 37,
    punchClimbM: 50,
    topSpeedKmh: [120, 150],
  },
};
