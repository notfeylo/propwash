import { Battery, type PackState } from './Battery';
import type { FlightSim } from './flight/FlightSim';
import { MotorModel, targetRpm } from './MotorModel';
import { type PowerEvent, PowerStateMachine } from './PowerStateMachine';

/**
 * Battery + ESCs + motors. Input code calls the action methods; `update` advances everything and
 * returns the frame's power events for audio and UI.
 *
 * On the bench (Phase 1) it runs its own RPM model and cosmetic pack. With a flight sim attached
 * (Phase 2) the power and arming logic stay here, and the motors, pack and body are the sim's.
 */
export class Powertrain {
  readonly power = new PowerStateMachine();
  readonly motors: MotorModel;
  /** Flight physics, when attached; otherwise the bench model runs. */
  flight: FlightSim | null = null;
  private benchBattery = new Battery();
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

  get battery(): PackState {
    return this.flight?.battery ?? this.benchBattery;
  }

  get rpms(): number[] {
    return this.flight?.rpms ?? this.motors.rpms;
  }

  /** dRPM/dt per motor (RPM/s), for the audio transient layer. */
  get rpmRates(): number[] {
    if (this.flight) return this.flight.motors.motors.map((m) => (m.domega * 60) / (2 * Math.PI));
    return this.motors.motors.map((m) => m.rpmRate);
  }

  /** Hand motors and pack to the flight sim; the pack's connection follows the power state. */
  attachFlight(sim: FlightSim): void {
    this.flight = sim;
    sim.battery.connected = this.power.powered;
    this.motors.setDrive('coast');
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
        if (this.flight) this.flight.arm();
        else this.motors.arm(this.rand);
      } else if (e.type === 'disarmed') {
        this.motors.setDrive('coast');
      }
    }
    if (this.flight) {
      // Group 1 has no flight controller: throttle drives all four motors open loop.
      const armed = this.power.armed;
      const t = this.throttle;
      this.flight.inputs = {
        driven: armed || this.testing,
        cmd: armed ? [t, t, t, t] : this.motorTest.values,
        stopAtZero: !armed,
      };
      this.flight.advance(dt);
      return events;
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
    this.benchBattery.update(dt, this.rpms, this.driven);
    return events;
  }
}
