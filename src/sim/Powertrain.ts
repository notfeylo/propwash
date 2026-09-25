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
  /**
   * Motor test (Betaflight Motors tab): while enabled and the drone is powered but disarmed, each
   * motor runs at its own 0..1 command (0 = stopped, not idle). Arming is blocked meanwhile.
   */
  readonly motorTest = { enabled: false, values: [0, 0, 0, 0] };

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

  /** Motors are spinning under the motor test (powered, disarmed, test enabled). */
  get testing(): boolean {
    return this.motorTest.enabled && this.power.powered && !this.power.armed;
  }

  /** ESCs are driving the motors (armed, or the motor test). */
  get driven(): boolean {
    return this.power.armed || this.testing;
  }

  setMotorTest(enabled: boolean): void {
    this.motorTest.enabled = enabled;
    if (!enabled) this.motorTest.values.fill(0);
  }

  toggleArm(): void {
    if (this.power.armed) this.power.disarm();
    else this.arm();
  }

  /** Refused (false) while the motor test is on, like Betaflight while its Motors tab is open. */
  arm(): boolean {
    if (this.motorTest.enabled) return false;
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
    const testing = this.testing;
    if (!this.power.armed) this.motors.setDrive(testing ? 'driven' : 'coast');
    const targets = this.motors.motors.map((_, i) => {
      if (this.power.armed) return targetRpm(this.throttle, v);
      const t = this.motorTest.values[i];
      return testing && t > 0 ? targetRpm(t, v) : 0;
    });
    this.motors.update(dt, targets);
    this.battery.update(dt, this.rpms, this.driven);
    return events;
  }
}
