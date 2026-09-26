import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freestyle7 } from '../../src/config/airframes';
import { parseBlackboxCsv, toCsv } from '../../src/sim/blackbox';
import { FlightSim } from '../../src/sim/flight/FlightSim';
import { flyImportedLog, FlightRecorder, ReplayRun } from '../../src/sim/recorder';
import { Rng } from '../../src/sim/rng';
import { stepResponse } from '../../src/sim/stepResponse';
import { v3 } from '../../src/sim/vec';
import { initRapier, labReport } from './lab';

// Flight Lab, group 6 (Phase 2 PRD §8.2–§8.3): blackbox, CSV, step response, log import, replay.

const lab = labReport('group6');
beforeAll(initRapier);
afterAll(() => lab.flush());

const newSim = (seed = 3) =>
  new FlightSim({ rapier: RAPIER, airframe: freestyle7, wind: 'calm', seed, spawn: v3(0, 200, 0) });

/**
 * A pilot-like stick log: a 1 s hover after arming, then held moves and returns on roll and pitch
 * (up to ≈ 60% stick, the mixer stays out of saturation), some yaw, throttle around hover.
 */
function pilot(seed: number) {
  const r = new Rng(seed);
  let roll = 0;
  let pitch = 0;
  let yaw = 0;
  return (step: number) => {
    if (step >= 1000) {
      if (step % 180 === 0) roll = r.uniform() < 0.5 ? 0 : (r.uniform() - 0.5) * 1.2;
      if (step % 230 === 0) pitch = r.uniform() < 0.5 ? 0 : (r.uniform() - 0.5) * 1.0;
      if (step % 400 === 0) yaw = r.uniform() < 0.4 ? 0 : (r.uniform() - 0.5) * 0.8;
    }
    return { throttle: 0.28 + 0.03 * Math.sin(step / 700), roll, pitch, yaw };
  };
}

/** Fly `seconds` with the recorder attached; returns the finished recording. */
function recordFlight(sim: FlightSim, seconds: number, seed = 11) {
  const rec = new FlightRecorder(sim);
  sim.setBattery(true, true);
  const stick = pilot(seed);
  sim.inputs = { driven: true, cmd: [0, 0, 0, 0], sticks: stick(0) };
  sim.arm(true);
  for (let k = 0; k < seconds * 1000; k++) {
    if (k % 16 === 0) sim.inputs = { driven: true, cmd: [0, 0, 0, 0], sticks: stick(k) };
    sim.stepOnce();
  }
  rec.end();
  return rec.last!;
}

describe('blackbox', () => {
  it('records at 500 Hz and exports a blackbox_decode-style CSV that parses back', () => {
    const sim = newSim();
    const r = recordFlight(sim, 4);
    const bb = r.blackbox;
    const csv = toCsv(bb);
    const header = csv.slice(0, csv.indexOf('\n')).split(',');
    const log = parseBlackboxCsv(csv);
    const err = Math.max(
      ...[0, 1, 2].map((k) => {
        const a = bb.series((['gyro.roll', 'gyro.pitch', 'gyro.yaw'] as const)[k]);
        return Math.max(...a.map((v, i) => Math.abs(v - log.gyro[k][i])));
      }),
    );
    lab.log(
      `Blackbox: ${bb.length} samples over ${bb.duration.toFixed(2)} s (${bb.rateHz} Hz) · CSV ${header.length} columns (${header.slice(0, 4).join(', ')}, … gyroADC[0], setpoint[0], motor[0], eRPM[0], …) · ${(csv.length / 1024).toFixed(0)} KB · parsed back at ${log.rateHz.toFixed(0)} Hz, worst gyro round-trip error ${err.toFixed(3)}°/s (2-decimal CSV)`,
    );
    for (const c of ['time (us)', 'gyroADC[0]', 'gyroUnfilt[2]', 'setpoint[3]', 'rcCommand[3]', 'motor[3]', 'axisP[1]'])
      expect(header).toContain(c);
    expect(bb.rateHz).toBe(500);
    expect(Math.abs(log.rateHz - 500)).toBeLessThan(1);
    expect(err).toBeLessThan(0.006);
    sim.dispose();
  });
});

describe('step response', () => {
  it('recovers a known system: 5 ms delay + first-order lag τ = 20 ms', () => {
    const rate = 500;
    const n = rate * 30;
    const r = new Rng(4);
    const sp = new Float32Array(n);
    const gyro = new Float32Array(n);
    let v = 0;
    let y = 0;
    for (let i = 0; i < n; i++) {
      if (i % 150 === 0) v = r.uniform() < 0.3 ? 0 : (r.uniform() - 0.5) * 600;
      sp[i] = v;
      const u = i >= 3 ? sp[i - 3] : 0; // ≈ 6 ms at 500 Hz
      y += (u - y) * (1 - Math.exp(-1 / rate / 0.02));
      gyro[i] = y + (r.uniform() - 0.5) * 4;
    }
    const s = stepResponse(sp, gyro, rate)!;
    // Analytic: delay 6 ms + τ·ln2 = 19.9 ms to 50%; + τ·ln10 = 52 ms to 90%.
    lab.log(
      `Step response check (synthetic: 6 ms delay + 20 ms lag): 50% at ${(s.delay50 * 1000).toFixed(1)} ms (exact 19.9), 90% at ${(s.rise90 * 1000).toFixed(1)} ms (exact 52.1), overshoot ${(s.overshoot * 100).toFixed(1)}% (exact 0) · ${s.segments}/${s.examined} segments`,
    );
    expect(Math.abs(s.delay50 - 0.0199)).toBeLessThan(0.004);
    expect(Math.abs(s.rise90 - 0.0521)).toBeLessThan(0.008);
    expect(s.overshoot).toBeLessThan(0.05);
  });

  it("measures the sim's own rate loop", () => {
    const sim = newSim();
    const r = recordFlight(sim, 20, 5);
    const b = r.blackbox;
    const res = (['roll', 'pitch', 'yaw'] as const).map((a) =>
      stepResponse(b.series(`sp.${a}`), b.series(`gyro.${a}`), b.rateHz),
    );
    lab.log(
      `Sim step response (freestyle7, 20 s of stick steps): ${(['roll', 'pitch', 'yaw'] as const)
        .map((a, k) => {
          const s = res[k];
          return s
            ? `${a} 50% ${(s.delay50 * 1000).toFixed(0)} ms, 90% ${(s.rise90 * 1000).toFixed(0)} ms, overshoot ${(s.overshoot * 100).toFixed(0)}%`
            : `${a} n/a`;
        })
        .join(' · ')}`,
    );
    expect(res[0]).not.toBeNull();
    expect(res[0]!.rise90).toBeLessThan(0.15);
    sim.dispose();
  });
});

describe('blackbox import and overlay (§8.3, synthetic logs)', () => {
  it('a log exported from the sim flies back through the sim and overlays its own gyro', () => {
    const src = newSim(21);
    const rec = recordFlight(src, 8, 9);
    const log = parseBlackboxCsv(toCsv(rec.blackbox));
    src.dispose();

    const sim = newSim(21);
    const out = flyImportedLog(sim, log, 'setpoint');
    const rms = (k: number) => {
      let s = 0;
      for (let i = 0; i < log.time.length; i++) s += (out.gyro[k][i] - log.gyro[k][i]) ** 2;
      return Math.sqrt(s / log.time.length);
    };
    const sd = (k: number) => Math.sqrt(log.gyro[k].reduce((a, v) => a + v * v, 0) / log.time.length);
    lab.log(
      `Import (synthetic log = the sim's own CSV, driven by its setpoints): gyro RMS error roll ${rms(0).toFixed(1)}, pitch ${rms(1).toFixed(1)}, yaw ${rms(2).toFixed(1)} °/s against signal RMS ${sd(0).toFixed(0)} / ${sd(1).toFixed(0)} / ${sd(2).toFixed(0)} °/s`,
    );
    expect(rms(0)).toBeLessThan(0.25 * sd(0));
    expect(rms(1)).toBeLessThan(0.25 * sd(1));

    // A different airframe (heavier, laggier) must show up as a larger mismatch.
    const heavy = new FlightSim({
      rapier: RAPIER,
      airframe: {
        ...freestyle7,
        inertia: {
          roll: freestyle7.inertia.roll * 1.8,
          pitch: freestyle7.inertia.pitch * 1.8,
          yaw: freestyle7.inertia.yaw * 1.8,
        },
      },
      wind: 'calm',
      seed: 21,
      spawn: v3(0, 200, 0),
    });
    const outH = flyImportedLog(heavy, log, 'setpoint');
    let e = 0;
    for (let i = 0; i < log.time.length; i++) e += (outH.gyro[0][i] - log.gyro[0][i]) ** 2;
    const rmsHeavy = Math.sqrt(e / log.time.length);
    lab.log(
      `Import: the same log through a 1.8× inertia airframe: roll RMS error ${rmsHeavy.toFixed(1)} °/s (the mismatch the tuning loop closes)`,
    );
    expect(rmsHeavy).toBeGreaterThan(rms(0) * 1.5);
    sim.dispose();
    heavy.dispose();
  });
});

describe('replay through the recorder', () => {
  it('ReplayRun resimulates a recording bit-identically, blackbox against blackbox', () => {
    const sim = newSim(8);
    const rec = recordFlight(sim, 6, 3);
    const t0 = performance.now();
    const run = new ReplayRun(newSim(8), rec);
    while (!run.done) run.run(1e9);
    const ms = performance.now() - t0;
    const diff = run.verify();
    lab.log(
      `Replay: ${run.duration.toFixed(2)} s flight → ${run.blackbox.length} replay samples vs ${rec.blackbox.length} recorded · first difference: ${diff === -1 ? 'none (bit-identical)' : diff} · ${((run.duration * 1000) / ms).toFixed(1)}× real time`,
    );
    expect(diff).toBe(-1);
    expect(run.blackbox.length).toBe(rec.blackbox.length);
    sim.dispose();
    run.dispose();
  });
});
