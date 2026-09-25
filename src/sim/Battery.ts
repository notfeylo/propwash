import { BATTERY } from '../config/motor';

/** Open-circuit volts per cell at a state of charge (0..1), linear between curve points. */
export function ocvPerCell(soc: number, curve: readonly (readonly [number, number])[] = BATTERY.ocvCurve): number {
  const s = Math.min(1, Math.max(0, soc));
  for (let i = 1; i < curve.length; i++) {
    const [s1, v1] = curve[i];
    const [s0, v0] = curve[i - 1];
    if (s <= s1) return v0 + ((s - s0) / (s1 - s0)) * (v1 - v0);
  }
  return curve[curve.length - 1][1];
}

/** What the HUD, OSD and power logic read from a pack (bench `Battery` or flight `FlightBattery`). */
export interface PackState {
  connected: boolean;
  voltage: number;
  readonly cellVoltage: number;
  current: number;
  usedMah: number;
  readonly soc: number;
  lowWarning: boolean;
  restingVoltage(): number;
}

/**
 * Cosmetic pack model (PRD §4.4): current from motor load (I ≈ k·Σrpm³), voltage sag
 * across internal resistance, and a mAh counter. Feeds the OSD and the motor ceiling.
 */
export class Battery {
  /** Consumed charge (mAh). */
  usedMah = 0;
  /** Instantaneous current (A). */
  current = 0;
  /** Terminal voltage, lightly filtered (V). */
  voltage: number;
  /** Seconds the per-cell voltage has been under the warning level. */
  private lowFor = 0;
  lowWarning = false;

  constructor(
    public connected = false,
    initialSoc = 1,
  ) {
    this.usedMah = (1 - initialSoc) * BATTERY.capacityMah;
    this.voltage = this.restingVoltage();
  }

  get soc(): number {
    return Math.max(0, 1 - this.usedMah / BATTERY.capacityMah);
  }

  get cellVoltage(): number {
    return this.voltage / BATTERY.cells;
  }

  restingVoltage(): number {
    return ocvPerCell(this.soc) * BATTERY.cells;
  }

  /** Motor current for a set of RPMs (A). */
  static motorCurrent(rpms: readonly number[]): number {
    return rpms.reduce((s, r) => s + (Math.abs(r) / 1000) ** 3, 0) * BATTERY.currentPerKrpm3;
  }

  update(dt: number, rpms: readonly number[], motorsPowered: boolean): void {
    if (!this.connected) {
      this.current = 0;
      this.lowFor = 0;
      this.lowWarning = false;
      return;
    }
    this.current = BATTERY.baseCurrentA + (motorsPowered ? Battery.motorCurrent(rpms) : 0);
    this.usedMah += (this.current * dt) / 3.6; // A·s → mAh
    const target = this.restingVoltage() - this.current * BATTERY.resistanceOhm;
    const k = dt > 0 ? 1 - Math.exp(-dt / BATTERY.filterTauS) : 0;
    this.voltage += (target - this.voltage) * k;
    this.lowFor = this.cellVoltage < BATTERY.warnCellV ? this.lowFor + dt : 0;
    this.lowWarning = this.lowFor >= BATTERY.warnHoldS;
  }
}
