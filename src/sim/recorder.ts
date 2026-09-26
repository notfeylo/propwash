import { BLACKBOX, FLIGHT_LAB } from '../config/blackbox';
import { Blackbox, type ImportedLog } from './blackbox';
import type { FlightCheckpoint, FlightOp, FlightSim } from './flight/FlightSim';
import { v3 } from './vec';

// Flight recordings and replays (Phase 2 PRD §8.2). A recording starts when the drone arms: a
// checkpoint of the whole sim, then every outside change (inputs, arming, resets, settings) and
// the blackbox at 500 Hz. A replay restores the checkpoint in a second sim and feeds it the log;
// the sim is deterministic, so it flies the same flight, which the blackboxes prove bitwise.

export interface FlightRecording {
  checkpoint: FlightCheckpoint;
  ops: FlightOp[];
  /** The live blackbox, sampled on even steps from the checkpoint. */
  blackbox: Blackbox;
  /** Step the recording ended at (set when it ends). */
  endStep: number;
  startedAt: Date;
  airframeId: string;
  seed: number;
}

export class FlightRecorder {
  active: FlightRecording | null = null;
  /** The latest finished recording (the one the replay plays). */
  last: FlightRecording | null = null;
  /** Called when a recording ends. */
  onEnd?: (r: FlightRecording) => void;
  private tail = 0;

  constructor(private sim: FlightSim) {
    sim.beforeArm = () => this.begin();
    sim.onStep = (s) => {
      const r = this.active;
      if (r && (s.stepCount - r.checkpoint.step) % 2 === 0) r.blackbox.sample(s);
    };
  }

  /** Newest recording: the one in progress, else the last finished. */
  get current(): FlightRecording | null {
    return this.active ?? this.last;
  }

  private begin(): void {
    this.tail = 0;
    if (this.active) return;
    const ops: FlightOp[] = [];
    const checkpoint = this.sim.checkpoint();
    this.sim.log = ops;
    this.active = {
      checkpoint,
      ops,
      blackbox: new Blackbox(),
      endStep: checkpoint.step,
      startedAt: new Date(),
      airframeId: this.sim.airframe.id,
      seed: checkpoint.seed,
    };
  }

  /** Per frame: end the recording a few seconds after the disarm, or when it's full. */
  update(dt: number, armed: boolean): void {
    const r = this.active;
    if (!r) return;
    r.endStep = this.sim.stepCount;
    this.tail = armed ? 0 : this.tail + dt;
    if (this.tail >= BLACKBOX.tailS || r.blackbox.full) this.end();
  }

  end(): void {
    const r = this.active;
    if (!r) return;
    r.endStep = this.sim.stepCount;
    this.sim.log = null;
    this.active = null;
    this.last = r;
    this.onEnd?.(r);
  }
}

/**
 * A replay: a second sim restored from the recording's checkpoint, resimulated ahead of playback
 * a few milliseconds per frame. Its own blackbox is what playback reads.
 */
export class ReplayRun {
  readonly blackbox = new Blackbox();
  private next = 0;
  private readonly start: number;

  constructor(
    readonly sim: FlightSim,
    readonly rec: FlightRecording,
  ) {
    sim.restoreCheckpoint(rec.checkpoint);
    this.start = rec.checkpoint.step;
    sim.onStep = (s) => {
      if ((s.stepCount - this.start) % 2 === 0) this.blackbox.sample(s);
    };
  }

  get done(): boolean {
    return this.sim.stepCount >= this.rec.endStep;
  }

  /** Recording length (s). */
  get duration(): number {
    return (this.rec.endStep - this.start) / 1000;
  }

  /** Resimulated so far (s). */
  get ready(): number {
    return (this.sim.stepCount - this.start) / 1000;
  }

  /** Resimulate for up to `budgetMs` of wall time (or `maxSteps`). */
  run(budgetMs: number, maxSteps = Infinity): void {
    const t0 = performance.now();
    const ops = this.rec.ops;
    let n = 0;
    while (!this.done && n < maxSteps) {
      while (this.next < ops.length && ops[this.next].step === this.sim.stepCount) this.sim.applyOp(ops[this.next++]);
      this.sim.stepOnce();
      if (++n % 50 === 0 && performance.now() - t0 > budgetMs) break;
    }
  }

  /** First sample where the replay left the recording (−1: bit-identical so far). */
  mismatch = -1;
  private checked = 0;

  /** Compare the newly resimulated samples with the recording; returns `mismatch`. */
  verify(): number {
    if (this.mismatch >= 0) return this.mismatch;
    const upTo = Math.min(this.blackbox.length, this.rec.blackbox.length);
    this.mismatch = this.blackbox.firstDifference(this.rec.blackbox, this.checked, upTo);
    this.checked = upTo;
    return this.mismatch;
  }

  dispose(): void {
    this.sim.dispose();
  }
}

/**
 * Fly a real blackbox log through the sim (PRD §8.3): the log's rate setpoints (or sticks) and
 * throttle drive our flight controller at 1 kHz, high above flat ground; the sim's own blackbox
 * comes back at the log's sample times for the overlay.
 */
export function flyImportedLog(
  sim: FlightSim,
  log: ImportedLog,
  drive: 'setpoint' | 'sticks' = log.setpoint ? 'setpoint' : 'sticks',
): { gyro: [Float32Array, Float32Array, Float32Array]; setpoint: [Float32Array, Float32Array, Float32Array] } {
  const n = log.time.length;
  const out = {
    gyro: [new Float32Array(n), new Float32Array(n), new Float32Array(n)] as [Float32Array, Float32Array, Float32Array],
    setpoint: [new Float32Array(n), new Float32Array(n), new Float32Array(n)] as [
      Float32Array,
      Float32Array,
      Float32Array,
    ],
  };
  sim.reset(v3(0, FLIGHT_LAB.importAltitudeM, 0));
  sim.setBattery(true, true);
  const at = (arr: Float32Array | undefined, r: number) => arr?.[r] ?? 0;
  const inputsAt = (r: number) => ({
    driven: true,
    cmd: [0, 0, 0, 0],
    sticks: {
      throttle: log.throttle[r],
      roll: at(log.rc?.[0], r),
      pitch: at(log.rc?.[1], r),
      yaw: at(log.rc?.[2], r),
    },
    setpoint:
      drive === 'setpoint' && log.setpoint
        ? { roll: log.setpoint[0][r], pitch: log.setpoint[1][r], yaw: log.setpoint[2][r] }
        : undefined,
  });
  sim.inputs = inputsAt(0);
  sim.arm(true);
  let r = 0;
  const t0 = sim.state.time;
  while (r < n) {
    // Sample-and-hold the log's row for the sim steps up to its time.
    while (r < n && log.time[r] <= sim.state.time - t0 + 1e-9) {
      const tel = sim.fc.telemetry;
      out.gyro[0][r] = tel.gyro.roll;
      out.gyro[1][r] = tel.gyro.pitch;
      out.gyro[2][r] = tel.gyro.yaw;
      out.setpoint[0][r] = tel.setpoint.roll;
      out.setpoint[1][r] = tel.setpoint.pitch;
      out.setpoint[2][r] = tel.setpoint.yaw;
      sim.inputs = inputsAt(r);
      r++;
    }
    sim.stepOnce();
  }
  return out;
}
