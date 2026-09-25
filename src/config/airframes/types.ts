// Airframe preset shape (Phase 2 PRD §2.1). Everything in SI units: kg, m, s, rad, N, Ω.

export type Chemistry = 'lipo' | 'liion';

export interface PackSpec {
  chemistry: Chemistry;
  /** Cells in series. */
  series: number;
  /** Cells in parallel. */
  parallel: number;
  capacityMah: number;
  /** Internal resistance per cell (Ω). Pack R = series × this / parallel. */
  rIntPerCellOhm: number;
}

export type AirframeId = 'freestyle7' | 'longrange7' | 'longrange7_payload';

export interface Airframe {
  id: AirframeId;
  label: string;
  /** All-up weight (kg). */
  massKg: number;
  /** Principal inertia about body pitch (x, right), yaw (y, up) and roll (z, nose axis), kg·m². */
  inertia: { pitch: number; yaw: number; roll: number };
  /** Centre of mass in the model frame (m). */
  com: readonly [number, number, number];
  pack: PackSpec;
  /** Body drag area (m²) for flow along the nose axis (front) and along the up axis (top). */
  cdA: { front: number; top: number };
  /** Payload canister fitted (visual toggle and collider). */
  payload: boolean;
  /** The PRD's reference values for this preset, checked by the Flight Lab tests. */
  reference: {
    thrustToWeight: number;
    hoverRpm: number;
    hoverCmd: number;
    /** Flight Lab pass bands (§8.1). */
    hoverCmdBand: readonly [number, number];
    /** Peak accelerometer reading (thrust / weight, g) during the punch. */
    punchAccelG: readonly [number, number];
    punchSpeedMs: number;
    punchClimbM: number;
    topSpeedKmh: readonly [number, number];
  };
}
