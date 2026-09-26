import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROP_WASH } from '../../src/config/aero';
import { freestyle7 } from '../../src/config/airframes';
import { BandPass } from '../../src/sim/fc/filters';
import type { Sticks } from '../../src/sim/fc/FlightController';
import type { FlightSim } from '../../src/sim/flight/FlightSim';
import { attitude } from '../../src/sim/frames';
import { fly, initRapier, labReport, makeSim, run } from './lab';

// Flight Lab, task group 4 (Phase 2 PRD §2.4, §6, §8.1): prop wash.

const lab = labReport('group4');
const log = lab.log;
beforeAll(initRapier);
afterAll(() => lab.flush());
const DEG = 180 / Math.PI;
const HOVER = 0.263;

/** RMS of the gyro's 10–40 Hz band (roll and pitch, deg/s) over `seconds`, as the FC sees it. */
function bandRms(s: FlightSim, seconds: number, sticks: Sticks): { rms: number; wobbleDeg: number; wash: number } {
  const bp = { roll: new BandPass(10, 40, s.h), pitch: new BandPass(10, 40, s.h) };
  let sum = 0;
  let n = 0;
  let k = 0;
  let wash = 0;
  const att0 = attitude(s.state.quaternion);
  let wobble = 0;
  fly(s, sticks);
  run(s, seconds, (x) => {
    const g = x.fc.telemetry.gyro;
    const r = bp.roll.apply(g.roll);
    const p = bp.pitch.apply(g.pitch);
    // Skip the filters' own start-up.
    if (k++ > 60) {
      sum += r * r + p * p;
      n += 2;
    }
    wash = Math.max(wash, x.state.propWash);
    const a = attitude(x.state.quaternion);
    wobble = Math.max(wobble, Math.abs(a.roll - att0.roll) * DEG, Math.abs(a.pitch - att0.pitch) * DEG);
  });
  return { rms: Math.sqrt(sum / n), wobbleDeg: wobble, wash };
}

/** Clean hover, then a vertical descent to 7 m/s, then a 60% punch; band RMS in each. */
function scenario() {
  const s = makeSim(freestyle7, { altitude: 120 });
  s.fc.mode = 'angle'; // level throughout, so the descent is vertical
  fly(s, { throttle: HOVER, roll: 0, pitch: 0, yaw: 0 });
  s.arm();
  run(s, 1.5);
  const hover = bandRms(s, 1, { throttle: HOVER, roll: 0, pitch: 0, yaw: 0 });
  // Throttle down until the drone falls at 7 m/s.
  fly(s, { throttle: 0.05, roll: 0, pitch: 0, yaw: 0 });
  let guard = 0;
  while (s.state.velocity.y > -7 && guard++ < 10000) s.stepOnce();
  const vDescent = s.state.velocity.y;
  // The punch is flown in Acro, as pilots do: nothing self-levels the wobble away.
  s.fc.mode = 'acro';
  const punch = bandRms(s, 0.6, { throttle: 0.6, roll: 0, pitch: 0, yaw: 0 });
  s.dispose();
  return { hover, punch, vDescent };
}

describe('T8 prop wash', () => {
  it('7 m/s vertical descent then a 60% punch: 10–40 Hz gyro RMS ≥ 3× clean hover, visible wobble', () => {
    const r = scenario();
    const ratio = r.punch.rms / r.hover.rms;

    // Control: the same flight with the wash model switched off.
    const saved = { ...PROP_WASH };
    Object.assign(PROP_WASH, { thrustLoss: 0, fluctuation: 0 });
    const c = scenario();
    Object.assign(PROP_WASH, saved);
    const ctlRatio = c.punch.rms / c.hover.rms;

    log(
      `T8: clean hover 10–40 Hz gyro RMS ${r.hover.rms.toFixed(2)}°/s · descent reached ${r.vDescent.toFixed(1)} m/s · 60% punch through the wash: ${r.punch.rms.toFixed(2)}°/s (×${ratio.toFixed(1)}), wash severity up to ${r.punch.wash.toFixed(2)}, attitude wobble ±${r.punch.wobbleDeg.toFixed(1)}° · PRD ≥ 3×, visible wobble`,
    );
    log(
      `T8 control, prop wash off: punch ${c.punch.rms.toFixed(2)}°/s (×${ctlRatio.toFixed(1)} hover), wobble ±${c.punch.wobbleDeg.toFixed(1)}°: the rise comes from the wash model`,
    );
    expect(Math.abs(r.vDescent + 7)).toBeLessThan(0.5);
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(r.punch.wobbleDeg).toBeGreaterThan(1);
    expect(ctlRatio).toBeLessThan(ratio / 2);
  });

  it('fades out with horizontal speed', () => {
    const s = makeSim(freestyle7, { altitude: 120 });
    s.fc.mode = 'angle';
    fly(s, { throttle: HOVER, roll: 0, pitch: 0, yaw: 0 });
    s.arm();
    run(s, 1);
    // The same 7 m/s descent, but also moving 8 m/s forward (horizontal airspeed well past 4 m/s).
    s.body.setLinvel({ x: 0, y: -7, z: -8 }, true);
    run(s, 0.02);
    const vh = Math.hypot(s.state.velocity.x, s.state.velocity.z);
    const r = bandRms(s, 0.6, { throttle: 0.6, roll: 0, pitch: 0, yaw: 0 });
    log(`T8: same descent while moving ${vh.toFixed(1)} m/s horizontally: wash severity up to ${r.wash.toFixed(2)}`);
    expect(vh).toBeGreaterThan(5);
    expect(r.wash).toBeLessThan(0.5);
    s.dispose();
  });
});
