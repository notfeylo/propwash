import { MOTOR_PROP, type PackSpec } from '../../config/airframes';
import { OCV_CURVES, PACK_WARNING } from '../../config/airframes/chemistry';
import { ocvPerCell } from '../Battery';

/**
 * Flight pack (Phase 2 PRD §2.5): V_loaded = V_ocv(SoC) − I·R_int, with I = Σ(Q·ω)/(η·V) plus the
 * electronics draw, and SoC integrated from mAh. Solved exactly each step: substituting I gives
 * V² − (V_ocv − R·I_e)·V + R·P/η = 0, and the pack sits on the upper root. Past the pack's maximum
 * power the roots vanish (brownout) and V holds at the maximum-power point, half the open-circuit.
 *
 * Exposes the same fields as the Phase 1 bench `Battery`, so the HUD, OSD and power logic read
 * either one.
 */
export class FlightBattery {
  connected = false;
  usedMah = 0;
  current = 0;
  voltage: number;
  lowWarning = false;
  /** Mechanical shaft power of all motors (W), last step. */
  shaftPowerW = 0;
  private lowFor = 0;

  constructor(
    readonly pack: PackSpec,
    initialSoc = 1,
  ) {
    this.usedMah = (1 - initialSoc) * pack.capacityMah;
    this.voltage = this.restingVoltage();
  }

  get rIntOhm(): number {
    return (this.pack.series * this.pack.rIntPerCellOhm) / this.pack.parallel;
  }

  get soc(): number {
    return Math.max(0, 1 - this.usedMah / this.pack.capacityMah);
  }

  get cellVoltage(): number {
    return this.voltage / this.pack.series;
  }

  restingVoltage(): number {
    return ocvPerCell(this.soc, OCV_CURVES[this.pack.chemistry]) * this.pack.series;
  }

  /**
   * @param shaftPowerW Σ(Q_i·ω_i) over the motors (W)
   * @param motorsPowered ESCs are driving (armed or motor test)
   */
  update(h: number, shaftPowerW: number, motorsPowered: boolean): void {
    if (!this.connected) {
      this.current = 0;
      this.shaftPowerW = 0;
      this.voltage = this.restingVoltage();
      this.lowFor = 0;
      this.lowWarning = false;
      return;
    }
    const m = MOTOR_PROP;
    const p = motorsPowered ? shaftPowerW / m.efficiency : 0;
    this.shaftPowerW = motorsPowered ? shaftPowerW : 0;
    const r = this.rIntOhm;
    const a = this.restingVoltage() - r * m.electronicsA;
    const disc = a * a - 4 * r * p;
    this.voltage = disc > 0 ? (a + Math.sqrt(disc)) / 2 : a / 2;
    this.current = m.electronicsA + p / this.voltage;
    this.usedMah += (this.current * h) / 3.6; // A·s → mAh
    this.lowFor = this.cellVoltage < PACK_WARNING.cellV ? this.lowFor + h : 0;
    this.lowWarning = this.lowFor >= PACK_WARNING.holdS;
  }
}
