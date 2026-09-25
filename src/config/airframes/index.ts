import { freestyle7 } from './freestyle7';
import { longrange7 } from './longrange7';
import { longrange7_payload } from './longrange7_payload';
import type { Airframe, AirframeId } from './types';

export * from './common';
export type { Airframe, AirframeId, Chemistry, PackSpec } from './types';
export { freestyle7, longrange7, longrange7_payload };

export const AIRFRAMES: Record<AirframeId, Airframe> = { freestyle7, longrange7, longrange7_payload };

/** The payload toggle switches between the two long-range presets (PRD §2.1). */
export const withPayload = (a: Airframe, payload: boolean): Airframe =>
  a.id === 'freestyle7' ? a : payload ? longrange7_payload : longrange7;
