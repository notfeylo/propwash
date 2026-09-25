import { BODY_BBOX_CENTER, PAYLOAD_COM_SHIFT_Y } from './common';
import type { Airframe } from './types';

/**
 * 7″ long range with the underslung payload canister (Phase 2 PRD §2.1). The PRD gives no
 * Flight Lab bands for this preset; they're scaled from `longrange7` by thrust-to-weight.
 */
export const longrange7_payload: Airframe = {
  id: 'longrange7_payload',
  label: '7″ long range + payload',
  massKg: 1.65,
  inertia: { pitch: 0.0095, yaw: 0.0125, roll: 0.009 },
  com: [BODY_BBOX_CENTER[0], BODY_BBOX_CENTER[1] + PAYLOAD_COM_SHIFT_Y, BODY_BBOX_CENTER[2]],
  pack: { chemistry: 'liion', series: 6, parallel: 2, capacityMah: 8000, rIntPerCellOhm: 0.02 },
  cdA: { front: 0.012, top: 0.028 },
  payload: true,
  reference: {
    thrustToWeight: 4.6,
    hoverRpm: 11450,
    hoverCmd: 0.41,
    hoverCmdBand: [0.39, 0.43],
    punchAccelG: [3.2, 4.2],
    punchSpeedMs: 33,
    punchClimbM: 45,
    topSpeedKmh: [110, 140],
  },
};
