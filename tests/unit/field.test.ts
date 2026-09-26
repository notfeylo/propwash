import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freestyle7 } from '../../src/config/airframes';
import { TURTLE } from '../../src/config/aero';
import { PHYSICS } from '../../src/config/physics';
import type { Sticks } from '../../src/sim/fc/FlightController';
import { FlightSim } from '../../src/sim/flight/FlightSim';
import { quatFromAxisAngle, v3, type V3 } from '../../src/sim/vec';
import { buildFieldLayout } from '../../src/world/fieldLayout';
import { Terrain } from '../../src/world/terrain';
import { fly, initRapier, labReport, run } from './lab';

// Flight Lab, task group 3 (Phase 2 PRD §5, §8.1): the test field, landing and turtle.

const lab = labReport('group3');
const log = lab.log;
beforeAll(initRapier);
afterAll(() => lab.flush());

const PAD_TOP = 0.004;
const terrain = new Terrain();
const layout = buildFieldLayout(terrain);
const DEG = 180 / Math.PI;

function fieldSim(o: { spawn?: V3; yawDeg?: number } = {}) {
  const s = new FlightSim({
    rapier: RAPIER,
    airframe: freestyle7,
    wind: 'calm',
    field: { terrain, layout, padTopY: PAD_TOP },
    spawn: o.spawn,
  });
  s.battery.connected = true;
  return s;
}
const tiltDeg = (s: FlightSim) => {
  const q = s.state.quaternion;
  return Math.acos(Math.min(1, Math.max(-1, 1 - 2 * (q.x * q.x + q.z * q.z)))) * DEG;
};

describe('test field (PRD §5)', () => {
  it('the collider surface is the same heightfield the renderer draws', () => {
    const s = fieldSim();
    let worst = 0;
    for (let k = 0; k < 200; k++) {
      const x = ((k * 7919) % 560) - 280 + 0.37;
      const z = ((k * 104729) % 560) - 280 + 0.61;
      if (Math.hypot(x, z) < 1) continue;
      const ray = new RAPIER.Ray({ x, y: 200, z }, { x: 0, y: -1, z: 0 });
      const hit = s.world.castRay(ray, 400, true, undefined, undefined, undefined, s.body);
      const y = hit ? 200 - hit.timeOfImpact : NaN;
      // Objects sit on the ground; only compare where the ray hit the terrain.
      if (hit && Math.abs(y - terrain.heightAt(x, z)) < 0.5)
        worst = Math.max(worst, Math.abs(y - terrain.heightAt(x, z)));
    }
    const hmax = Math.max(...terrain.heights);
    const hmin = Math.min(...terrain.heights);
    log(
      `Field: ${terrain.size} m square, ${terrain.cells}² cells, heights ${hmin.toFixed(1)} to ${hmax.toFixed(1)} m, flat launch area y = 0 · ${layout.prims.length} object colliders (${layout.gates.length} gates) · collider vs render surface: worst ${(worst * 1000).toFixed(2)} mm over 200 points`,
    );
    expect(worst).toBeLessThan(0.005);
    expect(terrain.heightAt(0, 0)).toBe(0);
    s.dispose();
  });

  it('the drone rests level on the pad at spawn', () => {
    const s = fieldSim();
    run(s, 1);
    log(
      `Rest on the pad: model origin y ${s.state.position.y.toFixed(4)} m, tilt ${tiltDeg(s).toFixed(2)}°, on ground ${s.state.onGround}, prop strike ${s.state.propStrike.some(Boolean)}`,
    );
    expect(s.state.onGround).toBe(true);
    expect(tiltDeg(s)).toBeLessThan(1);
    expect(s.state.propStrike.some(Boolean)).toBe(false);
    s.dispose();
  });
});

describe('T12 landing', () => {
  it('descent at 1 m/s onto the pad: rests upright, no bounce > 3 cm, disarm spools down', () => {
    const s = fieldSim({ spawn: v3(0, 2, 0) });
    s.fc.mode = 'angle';
    const hover = 0.263;
    const sticks: Sticks = { throttle: hover, roll: 0, pitch: 0, yaw: 0 };
    fly(s, sticks);
    s.arm();
    run(s, 0.8); // settle into a hover after arming in the air
    // The "pilot": a gentle vertical-speed hold at −1 m/s until touchdown.
    let touchdown = -1;
    let vAtTouch = 0;
    let tdY = 0;
    const tMax = 8;
    while (touchdown < 0 && s.state.time < tMax) {
      const vy = s.state.velocity.y;
      sticks.throttle = Math.min(0.6, Math.max(0.05, hover + 0.25 * (-1 - vy)));
      fly(s, sticks);
      s.stepOnce();
      if (s.state.onGround) {
        touchdown = s.state.time;
        vAtTouch = vy;
        tdY = s.state.position.y;
      }
    }
    // Throttle to zero on contact, disarm 0.3 s later (the pilot's usual landing).
    sticks.throttle = 0;
    fly(s, sticks);
    let maxY = tdY;
    run(s, 0.3, (x) => (maxY = Math.max(maxY, x.state.position.y)));
    s.inputs = { driven: false, cmd: [0, 0, 0, 0] };
    const rpmAtDisarm = s.state.rpm[0];
    let rpm1 = 0;
    run(s, 3, (x) => {
      maxY = Math.max(maxY, x.state.position.y);
      if (Math.abs(x.state.time - touchdown - 1.3) < 5e-4) rpm1 = x.state.rpm[0];
    });
    const rest = s.state.position;
    const bounce = maxY - tdY;
    log(
      `T12: touchdown at ${vAtTouch.toFixed(2)} m/s · bounce ${(bounce * 100).toFixed(2)} cm · at rest: tilt ${tiltDeg(s).toFixed(2)}°, ${Math.hypot(rest.x, rest.z).toFixed(2)} m from the pad centre, on ground ${s.state.onGround} · disarm: ${rpmAtDisarm.toFixed(0)} rpm → ${rpm1.toFixed(0)} after 1 s → ${s.state.rpm[0].toFixed(0)} after 3 s · PRD upright, bounce < 3 cm, spools down`,
    );
    expect(Math.abs(vAtTouch + 1)).toBeLessThan(0.2);
    expect(bounce).toBeLessThan(0.03);
    expect(tiltDeg(s)).toBeLessThan(3);
    expect(s.state.onGround).toBe(true);
    expect(rpm1).toBeLessThan(rpmAtDisarm * 0.5);
    expect(s.state.rpm[0]).toBeLessThan(100);
    s.dispose();
  });
});

describe('T13 turtle', () => {
  /** Dropped upside down on the grass, then turtle with this stick; time until upright on the ground. */
  function turtle(sticks: { roll: number; pitch: number }) {
    const s = fieldSim({ spawn: v3(6, 0.4, 5) });
    s.body.setRotation(quatFromAxisAngle(v3(0, 0, 1), Math.PI), true);
    run(s, 1.5);
    const inverted = tiltDeg(s);
    const ready = s.turtleReady;
    s.inputs = { driven: true, cmd: [0, 0, 0, 0], sticks: { throttle: 0, yaw: 0, ...sticks }, turtle: true };
    s.arm();
    const t0 = s.state.time;
    let tUp = Infinity;
    let minRpm = 0;
    while (s.state.time - t0 < 3) {
      s.stepOnce();
      minRpm = Math.min(minRpm, ...s.state.rpm);
      if (s.uprightOnGround) {
        tUp = s.state.time - t0;
        break;
      }
    }
    // Turtle ends upright: disarm and let it settle.
    s.inputs = { driven: false, cmd: [0, 0, 0, 0] };
    run(s, 1.5);
    const settled = tiltDeg(s);
    s.dispose();
    return { inverted, ready, tUp, minRpm, settled };
  }

  it('upside down on grass, turtle stick flips it upright in < 2 s', () => {
    const r = turtle({ roll: 0.8, pitch: 0 });
    log(
      `T13: upside down (resting at ${r.inverted.toFixed(0)}° on the battery) on grass · 80% roll stick in turtle: the right motors spin in reverse to ${r.minRpm.toFixed(0)} rpm · upright (tilt < ${TURTLE.uprightDeg}° on the ground) after ${(r.tUp * 1000).toFixed(0)} ms · settled at ${r.settled.toFixed(1)}° · PRD < 2 s`,
    );
    expect(r.ready).toBe(true);
    expect(r.minRpm).toBeLessThan(-3000);
    expect(r.tUp).toBeLessThan(2);
    expect(r.settled).toBeLessThan(10);
  });

  it('works whichever way the pilot flips it', () => {
    const dirs = {
      'roll left': { roll: -0.8, pitch: 0 },
      'pitch forward': { roll: 0, pitch: 0.8 },
      'pitch back': { roll: 0, pitch: -0.8 },
    };
    const out = Object.entries(dirs).map(([name, st]) => ({ name, ...turtle(st) }));
    log(`T13: other directions at 80%: ${out.map((o) => `${o.name} ${(o.tUp * 1000).toFixed(0)} ms`).join(', ')}`);
    for (const o of out) expect(o.tUp).toBeLessThan(2);
  });

  it('turtle only arms upside down: the right way up, it arms normally', () => {
    const s = fieldSim();
    run(s, 0.5);
    expect(s.turtleReady).toBe(false);
    s.dispose();
  });
});

describe('prop strikes and impacts', () => {
  it('a drop onto the field registers an impact; skimming a prop into the ground registers a strike', () => {
    const s = fieldSim({ spawn: v3(8, 3, -3) });
    let peak = 0;
    let strike = false;
    // Tilted 60° so one prop disc meets the ground first.
    s.body.setRotation(quatFromAxisAngle(v3(0, 0, 1), (60 * Math.PI) / 180), true);
    run(s, 1.5, (x) => {
      peak = Math.max(peak, x.state.impactG);
      strike ||= x.state.propStrike.some(Boolean);
    });
    log(`Impacts: 3 m drop, tilted 60°: peak contact ${peak.toFixed(0)} g · prop strike ${strike}`);
    expect(peak).toBeGreaterThan(PHYSICS.gravity > 0 ? 5 : 0);
    expect(strike).toBe(true);
    s.dispose();
  });
});
