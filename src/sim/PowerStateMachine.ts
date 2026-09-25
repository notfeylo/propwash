import { ARMING_FC } from '../config/fc';
import { ARMING, POWER } from '../config/motor';

export type PowerState = 'OFF' | 'BOOTING' | 'DISARMED' | 'ARMED' | 'SPINNING';
export type ArmBlocker = 'THROTTLE' | 'ANGLE' | 'FAILSAFE' | 'NO POWER' | 'BOOTING';

export type PowerEvent =
  | { type: 'plugged' }
  | { type: 'unplugged' }
  | { type: 'escPowerOnTones' }
  | { type: 'escSignalTones' }
  | { type: 'ready' }
  | { type: 'armed' }
  | { type: 'disarmed'; reason: 'switch' | 'kill' }
  | { type: 'armRefused'; reason: ArmBlocker }
  | { type: 'beacon'; on: boolean };

export interface PowerInputs {
  throttle: number;
  /** Tilt the flight controller measures (deg); arming needs it under Betaflight's small_angle. */
  tiltDeg?: number;
  failsafe?: boolean;
}

/**
 * Betaflight-faithful power / arming states (PRD §4.4):
 *
 *   OFF ─plug→ BOOTING ─(ESC tones ≈1.2 s)→ DISARMED ─arm (thr ≤ 5%)→ ARMED ⇄ SPINNING
 *   ARMED/SPINNING ─disarm | kill→ DISARMED (rotors coast)      any ─unplug→ OFF
 *   arm with throttle > 5% → stays DISARMED + "THROTTLE" warning + buzzer chirp
 */
export class PowerStateMachine {
  state: PowerState = 'OFF';
  /** Arming-disabled flag shown on the OSD; cleared once the cause is gone. */
  warning: ArmBlocker | null = null;
  beacon = false;
  failsafe = false;
  /** Seconds in the current state. */
  timeInState = 0;
  private pending: PowerEvent[] = [];

  get powered(): boolean {
    return this.state !== 'OFF';
  }

  get armed(): boolean {
    return this.state === 'ARMED' || this.state === 'SPINNING';
  }

  private go(state: PowerState): void {
    this.state = state;
    this.timeInState = 0;
  }

  private emit(e: PowerEvent): void {
    this.pending.push(e);
  }

  plug(): void {
    if (this.state !== 'OFF') return;
    this.go('BOOTING');
    this.emit({ type: 'plugged' });
  }

  unplug(): void {
    if (this.state === 'OFF') return;
    this.go('OFF');
    this.warning = null;
    this.beacon = false;
    this.emit({ type: 'unplugged' });
  }

  togglePlug(): void {
    if (this.state === 'OFF') this.plug();
    else this.unplug();
  }

  /** Attempt to arm. Returns whether it armed. */
  arm(inputs: PowerInputs): boolean {
    const blocker: ArmBlocker | null =
      this.state === 'OFF'
        ? 'NO POWER'
        : this.state === 'BOOTING'
          ? 'BOOTING'
          : (inputs.failsafe ?? this.failsafe)
            ? 'FAILSAFE'
            : inputs.throttle > ARMING.maxThrottle
              ? 'THROTTLE'
              : (inputs.tiltDeg ?? 0) > ARMING_FC.maxTiltDeg
                ? 'ANGLE'
                : null;
    if (this.armed) return true;
    if (blocker) {
      this.warning = blocker;
      this.emit({ type: 'armRefused', reason: blocker });
      return false;
    }
    this.warning = null;
    if (this.beacon) this.setBeacon(false);
    this.go('ARMED');
    this.emit({ type: 'armed' });
    return true;
  }

  disarm(reason: 'switch' | 'kill' = 'switch'): void {
    if (!this.armed) return;
    this.go('DISARMED');
    this.emit({ type: 'disarmed', reason });
  }

  toggleArm(inputs: PowerInputs): void {
    if (this.armed) this.disarm();
    else this.arm(inputs);
  }

  /** DShot beacon: only while disarmed (motors not driven). */
  setBeacon(on: boolean): void {
    const allowed = on ? this.state === 'DISARMED' : true;
    if (!allowed || this.beacon === on) return;
    this.beacon = on;
    this.emit({ type: 'beacon', on });
  }

  update(dt: number, inputs: PowerInputs): PowerEvent[] {
    const before = this.timeInState;
    this.timeInState += dt;
    const crossed = (t: number) => before < t && this.timeInState >= t;

    if (this.state === 'BOOTING') {
      if (before === 0 && POWER.escTonesAtS <= 0) this.emit({ type: 'escPowerOnTones' });
      if (crossed(POWER.escTonesAtS)) this.emit({ type: 'escPowerOnTones' });
      if (crossed(POWER.signalTonesAtS)) this.emit({ type: 'escSignalTones' });
      if (this.timeInState >= POWER.bootDurationS) {
        this.go('DISARMED');
        this.emit({ type: 'ready' });
      }
    }
    if (this.state === 'ARMED' && inputs.throttle > ARMING.spinningThrottle) this.go('SPINNING');
    else if (this.state === 'SPINNING' && inputs.throttle <= ARMING.spinningThrottle) this.go('ARMED');

    // The THROTTLE flag clears when the stick comes back down.
    if (this.warning === 'THROTTLE' && inputs.throttle <= ARMING.maxThrottle) this.warning = null;
    if (this.warning === 'ANGLE' && (inputs.tiltDeg ?? 0) <= ARMING_FC.maxTiltDeg) this.warning = null;
    if (this.warning === 'BOOTING' && this.state !== 'BOOTING') this.warning = null;
    if (this.warning === 'NO POWER' && this.powered) this.warning = null;

    const out = this.pending;
    this.pending = [];
    return out;
  }
}
