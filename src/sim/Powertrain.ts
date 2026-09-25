import { Battery } from './Battery';
import { MotorModel, targetRpm } from './MotorModel';
import { type PowerEvent, PowerStateMachine } from './PowerStateMachine';

/**
 * Battery + ESCs + motors on the bench (Phase 1: RPM and state only, no flight).
 * Input code calls the action methods; `update` advances everything and returns the
 * frame's power events for audio and UI.
 */
export class Powertrain {
  readonly power = new PowerStateMachine();
  readonly motors: MotorModel;
  readonly battery = new Battery();
  /** Commanded throttle, 0..1. */
  throttle = 0;
  /** Motor test panel overrides (0..1 throttle per motor), or null to follow the master throttle. */
  motorOverride: (number | null)[] = [null, null, null, null];

  constructor(
    seed?: number,
    private rand: () => number = Math.random,
  ) {
    this.motors = new MotorModel(undefined, seed);
  }

  get rpms(): number[] {
    return this.motors.rpms;
  }

  togglePlug(): void {
    this.power.togglePlug();
  }

  toggleArm(): void {
    this.power.toggleArm({ throttle: this.throttle });
  }

  arm(): boolean {
    return this.power.arm({ throttle: this.throttle });
  }

  disarm(): void {
    this.power.disarm('switch');
  }

  kill(): void {
    this.power.disarm('kill');
  }

  toggleBeacon(): void {
    this.power.setBeacon(!this.power.beacon);
  }

  update(dt: number): PowerEvent[] {
    const events = this.power.update(dt, { throttle: this.throttle });
    for (const e of events) {
      if (e.type === 'plugged') {
        this.battery.connected = true;
        this.battery.voltage = this.battery.restingVoltage();
      } else if (e.type === 'unplugged') {
        this.battery.connected = false;
        this.motors.setDrive('coast');
      } else if (e.type === 'armed') {
        this.motors.arm(this.rand);
      } else if (e.type === 'disarmed') {
        this.motors.setDrive('coast');
      }
    }
    const v = this.battery.connected ? this.battery.voltage : 0;
    const targets = this.motors.motors.map((_, i) =>
      this.power.armed ? targetRpm(this.motorOverride[i] ?? this.throttle, v) : 0,
    );
    this.motors.update(dt, targets);
    this.battery.update(dt, this.rpms, this.power.armed);
    return events;
  }
}
