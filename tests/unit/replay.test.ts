import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { longrange7, withPayload } from '../../src/config/airframes';
import { FlightSim, type FlightCheckpoint, type FlightOp } from '../../src/sim/flight/FlightSim';
import { Rng } from '../../src/sim/rng';
import { buildFieldLayout } from '../../src/world/fieldLayout';
import { Terrain } from '../../src/world/terrain';
import { initRapier, labReport } from './lab';

// Flight Lab, group 6 (Phase 2 PRD §8.2): a recorded flight replays bit-identically from its
// checkpoint and op log, on the real test field, through arming, payload swap, mode changes,
// a disarm and a pad reset.

const lab = labReport('group6-replay');
beforeAll(initRapier);
afterAll(() => lab.flush());

const terrain = new Terrain();
const layout = buildFieldLayout(terrain);
const opts = () => ({
  rapier: RAPIER,
  airframe: longrange7,
  wind: 'breezy' as const,
  field: { terrain, layout, padTopY: 0.02 },
});

describe('deterministic replay', () => {
  it('checkpoint + op log reproduce the live flight exactly', () => {
    const live = new FlightSim(opts());
    live.setBattery(true, true);
    const sticks = new Rng(5);
    // Idle on the pad for 1.3 s first: the recording starts mid-session, not at load.
    for (let i = 0; i < 1300; i++) live.stepOnce();

    let cp: FlightCheckpoint | null = null;
    const ops: FlightOp[] = [];
    live.beforeArm = () => {
      if (cp) return;
      cp = live.checkpoint();
      live.log = ops;
    };
    const trace: string[] = [];
    let armed = false;
    const frame = (k: number) => {
      // A frame of pilot input, the way Powertrain hands it over (a new object each frame).
      const t = k / 60;
      live.inputs = armed
        ? {
            driven: true,
            cmd: [0, 0, 0, 0],
            sticks: {
              throttle: 0.45 + 0.2 * Math.sin(t * 1.3) + 0.05 * sticks.uniform(),
              roll: 0.5 * Math.sin(t * 2.1),
              pitch: 0.3 * Math.sin(t * 0.7) + 0.1 * sticks.gaussian(),
              yaw: 0.2 * Math.cos(t),
            },
          }
        : { driven: false, cmd: [0, 0, 0, 0], stopAtZero: true };
      // Uneven frame lengths, some with no step at all.
      const n = [16, 17, 0, 33, 16][k % 5];
      for (let i = 0; i < n; i++) live.stepOnce();
    };
    for (let k = 0; k < 20; k++) frame(k);
    armed = true;
    live.arm();
    for (let k = 20; k < 300; k++) {
      if (k === 120)
        live.configureFc({
          mode: 'angle',
          idealSensors: false,
          ratesModel: 'actual',
          rates: live.fc.rates,
          gains: live.fc.gains,
        });
      if (k === 180) live.setAirframe(withPayload(longrange7, true));
      if (k === 240) armed = false;
      frame(k);
      if (k % 10 === 0) trace.push(JSON.stringify(live.state));
    }
    live.reset();
    armed = true;
    live.arm();
    for (let k = 300; k < 360; k++) frame(k);
    const end = JSON.stringify(live.state);
    const endStep = live.stepCount;
    expect(cp).not.toBeNull();
    const checkpoint = cp as unknown as FlightCheckpoint;

    // Replay: a fresh sim (same field and options), restored and fed the log.
    const t0 = performance.now();
    const rep = new FlightSim(opts());
    rep.restoreCheckpoint(checkpoint);
    let next = 0;
    let checked = 0;
    while (rep.stepCount < endStep) {
      while (next < ops.length && ops[next].step === rep.stepCount) rep.applyOp(ops[next++]);
      rep.stepOnce();
      if (checked < trace.length && JSON.stringify(rep.state) === trace[checked]) checked++;
    }
    const ms = performance.now() - t0;
    const same = JSON.stringify(rep.state) === end;
    lab.log(
      `Replay: ${((endStep - checkpoint.step) / 1000).toFixed(2)} s recorded from a checkpoint taken mid-session (breezy gusts, test field, arm, Angle-mode switch, payload swap, disarm, pad reset, re-arm), ${ops.length} logged ops · replay state identical at the end: ${same} · ${checked}/${trace.length} sampled states matched along the way · resimulated at ${((endStep - checkpoint.step) / ms).toFixed(0)}× real time`,
    );
    expect(same).toBe(true);
    expect(checked).toBe(trace.length);
    expect(ops.some((o) => o.op === 'airframe')).toBe(true);
    live.dispose();
    rep.dispose();
  });
});
