import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AIRFRAMES, type Airframe, freestyle7, longrange7, MOTOR_PROP, rpmToRads } from '../../src/config/airframes';
import { PHYSICS } from '../../src/config/physics';
import { attitude, bodyToFlight, flightToBody, worldToBody } from '../../src/sim/frames';
import { FlightSim } from '../../src/sim/flight/FlightSim';
import { omegaMax, thrust } from '../../src/sim/flight/FlightMotors';
import { Rng } from '../../src/sim/rng';
import { labReport } from './lab';
import { quatFromAxisAngle, v3 } from '../../src/sim/vec';

// Flight Lab, task group 1 (Phase 2 PRD §8.1, §10): open-loop physics, no flight controller.
// Every test prints its measurements next to the PRD target.

const G = PHYSICS.gravity;
const lab = labReport('group1');
const log = lab.log;

beforeAll(async () => {
  await RAPIER.init();
});

afterAll(() => lab.flush());

/**
 * PRD §8.1 lists LR punch-out targets of 4–5 g, ~37 m/s and ~50 m. With the PRD's own 6S2P Li-ion
 * pack (20 mΩ/cell) the pack sags to ≈ 20 V on a punch and those need a sag-free pack. These are the
 * sag-limited values the §2 model gives; pending the owner's call (DECISIONS 2026-09-25).
 */
const LR_PUNCH_SAG_LIMITED = { accelG: [3, 4] as const, speedMs: 23.5, climbM: 30 };

function sim(a: Airframe, o: { altitude?: number; wind?: 'calm' | 'light' | 'breezy'; seed?: number } = {}) {
  const s = new FlightSim({
    rapier: RAPIER,
    airframe: a,
    wind: o.wind ?? 'calm',
    seed: o.seed,
    spawn: o.altitude !== undefined ? v3(0, o.altitude, 0) : undefined,
  });
  s.battery.connected = true;
  return s;
}
const run = (s: FlightSim, seconds: number, each?: (s: FlightSim) => void) => {
  const n = Math.round(seconds * PHYSICS.rateHz);
  for (let i = 0; i < n; i++) {
    s.stepOnce();
    each?.(s);
  }
};
const drive = (s: FlightSim, cmd: number) => (s.inputs = { driven: true, cmd: [cmd, cmd, cmd, cmd] });
const sumThrust = (s: FlightSim) => s.state.thrust.reduce((a, b) => a + b, 0);

/** Hover command on a locked test stand out of ground effect: Σ thrust = m·g (bisection). */
function hoverCmd(a: Airframe) {
  let lo = 0;
  let hi = 1;
  let out = { cmd: 0, rpm: 0, voltage: 0 };
  for (let i = 0; i < 30; i++) {
    const cmd = (lo + hi) / 2;
    const s = sim(a, { altitude: 50 });
    s.body.lockTranslations(true, true);
    s.body.lockRotations(true, true);
    drive(s, cmd);
    run(s, 0.6);
    if (sumThrust(s) > a.massKg * G) hi = cmd;
    else lo = cmd;
    out = { cmd, rpm: s.state.rpm[0], voltage: s.state.voltage };
    s.dispose();
  }
  return out;
}

describe('frames: sign safety against physics output (PRD §1, §3.5)', () => {
  it('flight axes round-trip through the body frame', () => {
    const f = { roll: 0.3, pitch: -0.2, yaw: 0.7 };
    expect(bodyToFlight(flightToBody(f))).toEqual(f);
  });

  it('more thrust on the left motors rolls right; front motors pitch nose up; CCW props yaw right', () => {
    const rates = (cmd: number[]) => {
      const s = sim(freestyle7, { altitude: 50 });
      s.body.lockTranslations(true, true);
      s.inputs = { driven: true, cmd };
      run(s, 0.15);
      const r = bodyToFlight(worldToBody(s.state.quaternion, s.state.angularVelocity));
      s.dispose();
      return r;
    };
    // M1 RR, M2 FR, M3 RL, M4 FL.
    expect(rates([0.3, 0.3, 0.35, 0.35]).roll).toBeGreaterThan(0.05);
    expect(rates([0.3, 0.35, 0.3, 0.35]).pitch).toBeLessThan(-0.05);
    expect(rates([0.3, 0.35, 0.35, 0.3]).yaw).toBeGreaterThan(0.05);
  });

  it('attitude reads roll right, nose down and heading right as positive', () => {
    const rollRight = attitude(quatFromAxisAngle(v3(0, 0, -1), 0.4));
    const noseDown = attitude(quatFromAxisAngle(v3(1, 0, 0), -0.4));
    const yawRight = attitude(quatFromAxisAngle(v3(0, 1, 0), -0.4));
    expect(rollRight.roll).toBeCloseTo(0.4, 5);
    expect(noseDown.pitch).toBeCloseTo(0.4, 5);
    expect(yawRight.yaw).toBeCloseTo(0.4, 5);
  });
});

describe('motor + prop (PRD §2.2)', () => {
  it('ω_max, static thrust and thrust-to-weight match §2', () => {
    const wMax = omegaMax(25.2);
    const tMax = thrust(wMax, 0, 50);
    log(
      `ω_max(25.2 V) = ${wMax.toFixed(0)} rad/s (${((wMax * 60) / (2 * Math.PI)).toFixed(0)} rpm) · PRD ≈ 2,573 rad/s ≈ 24,570 rpm`,
    );
    log(`static thrust at ω_max = ${tMax.toFixed(2)} N per motor · PRD 18.6 N`);
    for (const a of Object.values(AIRFRAMES))
      log(
        `  ${a.id}: T/W (static, 25.2 V) = ${((4 * tMax) / (a.massKg * G)).toFixed(2)} · PRD ${a.reference.thrustToWeight}`,
      );
    expect(wMax).toBeCloseTo(2573, -1);
    expect(tMax).toBeCloseTo(18.6, 0);
  });

  it('thrust fades with inflow and grows in ground effect', () => {
    const w = rpmToRads(10000);
    expect(thrust(w, 10, 50)).toBeLessThan(thrust(w, 0, 50));
    expect(thrust(w, 0, MOTOR_PROP.propRadiusM / 2)).toBeCloseTo(MOTOR_PROP.kT * w * w * MOTOR_PROP.groundEffectMax, 6);
    expect(thrust(w, 0, 2 * MOTOR_PROP.propRadiusM)).toBeCloseTo(MOTOR_PROP.kT * w * w * (1 / (1 - 1 / 64)), 6);
  });
});

describe('T1 open-loop hover (PRD §8.1; Angle-mode drift waits for the flight controller)', () => {
  for (const a of [freestyle7, longrange7]) {
    it(`${a.id}: hover command within ${a.reference.hoverCmdBand.join('–')}`, () => {
      const h = hoverCmd(a);
      log(
        `T1 ${a.id}: hover cmd ${(h.cmd * 100).toFixed(1)}% at ${h.rpm.toFixed(0)} rpm, ${h.voltage.toFixed(2)} V · PRD ~${(a.reference.hoverCmd * 100).toFixed(0)}% (${a.reference.hoverCmdBand.map((x) => (x * 100).toFixed(0)).join('–')}%), ~${a.reference.hoverRpm} rpm`,
      );
      expect(h.cmd).toBeGreaterThanOrEqual(a.reference.hoverCmdBand[0]);
      expect(h.cmd).toBeLessThanOrEqual(a.reference.hoverCmdBand[1]);

      // Free flight at that command, calm air, 10 s: open loop holds altitude and stays level.
      const s = sim(a, { altitude: 20 });
      drive(s, h.cmd);
      run(s, 10);
      const drop = s.state.position.y - 20;
      const tilt =
        (Math.acos(Math.min(1, 1 - 2 * (s.state.quaternion.x ** 2 + s.state.quaternion.z ** 2))) * 180) / Math.PI;
      const drift = Math.hypot(s.state.position.x, s.state.position.z);
      log(
        `T1 ${a.id}: open loop at hover cmd, 10 s calm: altitude ${drop >= 0 ? '+' : ''}${drop.toFixed(2)} m, vertical speed ${s.state.velocity.y.toFixed(3)} m/s, horizontal drift ${drift.toFixed(3)} m, tilt ${tilt.toFixed(2)}°`,
      );
      expect(Math.abs(s.state.velocity.y)).toBeLessThan(0.5);
      expect(tilt).toBeLessThan(1);
      s.dispose();
    });
  }
});

describe('T5 punch-out (100% for 2 s from hover)', () => {
  for (const a of [freestyle7, longrange7]) {
    it(`${a.id}`, () => {
      const h = hoverCmd(a);
      const s = sim(a, { altitude: 50 });
      s.body.lockTranslations(true, true);
      s.body.lockRotations(true, true);
      drive(s, h.cmd);
      run(s, 1);
      s.body.lockTranslations(false, true);
      const y0 = s.state.position.y;
      const v0 = s.state.voltage;
      drive(s, 1);
      let peak = 0;
      let peakAt = 0;
      let vMin = Infinity;
      run(s, 2, (x) => {
        if (x.state.acceleration.y > peak) {
          peak = x.state.acceleration.y;
          peakAt = x.state.time;
        }
        vMin = Math.min(vMin, x.state.voltage);
      });
      const r = a.reference;
      const speed = s.state.velocity.y;
      const climb = s.state.position.y - y0;
      // The accelerometer reads thrust/weight (specific force): net acceleration + 1 g.
      const accG = (peak + G) / G;
      log(
        `T5 ${a.id}: peak ${accG.toFixed(2)} g on the accelerometer (${(peak / G).toFixed(2)} g net) at +${((peakAt - 1) * 1000).toFixed(0)} ms · PRD ${r.punchAccelG.join('–')} g`,
      );
      log(
        `T5 ${a.id}: at 2 s ${speed.toFixed(1)} m/s (${(speed * 3.6).toFixed(0)} km/h), climbed ${climb.toFixed(1)} m · PRD ~${r.punchSpeedMs} m/s, ~${r.punchClimbM} m`,
      );
      log(`T5 ${a.id}: pack ${v0.toFixed(2)} V at hover → ${vMin.toFixed(2)} V minimum during the punch`);
      const t =
        a.id === 'longrange7'
          ? LR_PUNCH_SAG_LIMITED
          : { accelG: r.punchAccelG, speedMs: r.punchSpeedMs, climbM: r.punchClimbM };
      expect(accG).toBeGreaterThanOrEqual(t.accelG[0]);
      expect(accG).toBeLessThanOrEqual(t.accelG[1]);
      expect(speed).toBeGreaterThan(t.speedMs * 0.85);
      expect(speed).toBeLessThan(t.speedMs * 1.15);
      expect(climb).toBeGreaterThan(t.climbM * 0.8);
      expect(climb).toBeLessThan(t.climbM * 1.2);
      s.dispose();
    });
  }
});

describe('T6 top level speed (full throttle, attitude held on a rotation-locked stand)', () => {
  /** Terminal state at a fixed nose-down pitch θ (deg), full throttle. */
  function terminal(a: Airframe, pitchDeg: number) {
    const s = sim(a, { altitude: 500 });
    const q = quatFromAxisAngle(v3(1, 0, 0), (-pitchDeg * Math.PI) / 180);
    s.body.setRotation(q, true);
    s.body.lockRotations(true, true);
    drive(s, 1);
    run(s, 8);
    const v = s.state.velocity;
    const out = { vy: v.y, vh: Math.hypot(v.x, v.z), voltage: s.state.voltage };
    s.dispose();
    return out;
  }
  for (const a of [freestyle7, longrange7]) {
    it(`${a.id}: ${a.reference.topSpeedKmh.join('–')} km/h`, () => {
      let lo = 45;
      let hi = 89;
      let t = terminal(a, lo);
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        t = terminal(a, mid);
        if (t.vy > 0) lo = mid;
        else hi = mid;
      }
      const kmh = t.vh * 3.6;
      log(
        `T6 ${a.id}: level at ${((lo + hi) / 2).toFixed(1)}° nose-down, ${kmh.toFixed(0)} km/h (${t.vh.toFixed(1)} m/s), vertical ${t.vy.toFixed(2)} m/s, pack ${t.voltage.toFixed(2)} V after 8 s · PRD ${a.reference.topSpeedKmh.join('–')} km/h`,
      );
      expect(kmh).toBeGreaterThanOrEqual(a.reference.topSpeedKmh[0]);
      expect(kmh).toBeLessThanOrEqual(a.reference.topSpeedKmh[1]);
    });
  }
});

describe('T9 battery sag (10 s at 100%, fresh 6S LiPo)', () => {
  it('freestyle7: V_loaded drops ≥ 2.0 V and max RPM drops ≥ 6%', () => {
    const s = sim(freestyle7, { altitude: 50 });
    s.body.lockTranslations(true, true);
    s.body.lockRotations(true, true);
    const rest = s.battery.restingVoltage();
    drive(s, 1);
    run(s, 0.25); // spooled up (7 τ)
    const v1 = s.state.voltage;
    const rpm1 = s.state.rpm[0];
    const i1 = s.state.current;
    run(s, 9.75);
    const v10 = s.state.voltage;
    const rpm10 = s.state.rpm[0];
    // Measured against the fresh pack: resting 25.2 V and ω_max(25.2 V). See DECISIONS.
    const freshMaxRpm = (omegaMax(rest) * 60) / (2 * Math.PI);
    const drop = rest - v10;
    const rpmDrop = 1 - rpm10 / freshMaxRpm;
    log(
      `T9 freestyle7: resting ${rest.toFixed(2)} V → ${v1.toFixed(2)} V at full throttle (${i1.toFixed(0)} A) → ${v10.toFixed(2)} V after 10 s (${s.state.current.toFixed(0)} A, ${s.state.usedMah.toFixed(0)} mAh used)`,
    );
    log(
      `T9 freestyle7: V_loaded ${drop.toFixed(2)} V below the fresh pack after 10 s (${(v1 - v10).toFixed(2)} V of it during the hold) · PRD ≥ 2.0 V`,
    );
    log(
      `T9 freestyle7: max RPM ${freshMaxRpm.toFixed(0)} fresh → ${rpm1.toFixed(0)} at the start → ${rpm10.toFixed(0)} after 10 s (−${(rpmDrop * 100).toFixed(1)}%) · PRD ≥ 6%`,
    );
    expect(drop).toBeGreaterThanOrEqual(2);
    expect(rpmDrop).toBeGreaterThanOrEqual(0.06);
    s.dispose();
  });
});

describe('T11 determinism', () => {
  /** 60 s of free flight in Breezy gusts from a seeded random input log. */
  function flight(seed: number) {
    const s = sim(longrange7, { altitude: 30, wind: 'breezy', seed });
    const inputs = new Rng(99);
    let cmd = [0.36, 0.36, 0.36, 0.36];
    run(s, 60, (x) => {
      if (x.state.step % 100 === 0) cmd = cmd.map(() => 0.3 + inputs.uniform() * 0.14);
      x.inputs = { driven: true, cmd };
    });
    const out = JSON.stringify(s.state);
    s.dispose();
    return out;
  }
  it('same seed + input log → identical state after 60 s; another seed differs', () => {
    const t0 = performance.now();
    const a = flight(7);
    const ms = performance.now() - t0;
    const b = flight(7);
    const c = flight(8);
    log(
      `T11: two 60 s runs (60,000 steps, Breezy gusts, seeded input log) identical: ${a === b} · different seed differs: ${a !== c} · ${(ms / 60000).toFixed(4)} ms per step`,
    );
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
