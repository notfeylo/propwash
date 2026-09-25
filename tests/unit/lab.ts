/// <reference types="node" />
import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Airframe } from '../../src/config/airframes';
import { PHYSICS } from '../../src/config/physics';
import type { Sticks } from '../../src/sim/fc/FlightController';
import { FlightSim } from '../../src/sim/flight/FlightSim';
import { v3 } from '../../src/sim/vec';

// Shared Flight Lab helpers (Phase 2 PRD §8.1). Vitest hides passing tests' logs, so each file
// collects its measurements and, with FLIGHT_LAB_DIR=<dir>, writes them to <dir>/<name>.md.

export function labReport(name: string) {
  const lines: string[] = [];
  return {
    log(s: string) {
      lines.push(s);
      console.log(s);
    },
    flush() {
      const dir = process.env.FLIGHT_LAB_DIR;
      if (!dir) return;
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${name}.md`), lines.map((l) => `- ${l}\n`).join(''));
    },
  };
}

export const G = PHYSICS.gravity;
export const initRapier = () => RAPIER.init();

export function makeSim(
  a: Airframe,
  o: { altitude?: number; wind?: 'calm' | 'light' | 'breezy'; seed?: number } = {},
): FlightSim {
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

export function run(s: FlightSim, seconds: number, each?: (s: FlightSim) => void): void {
  const n = Math.round(seconds * PHYSICS.rateHz);
  for (let i = 0; i < n; i++) {
    s.stepOnce();
    each?.(s);
  }
}

/** Armed flight through the flight controller with these sticks. */
export function fly(s: FlightSim, sticks: Sticks): void {
  s.inputs = { driven: true, cmd: [0, 0, 0, 0], sticks };
}
