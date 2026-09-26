import { FIELD_OBJECTS } from '../config/field';
import { mulberry32 } from '../sim/MotorModel';
import type { Terrain } from './terrain';

// Test-field objects as plain primitives (Phase 2 PRD §5): the physics builds Rapier colliders and
// the renderer builds meshes from the same list. Pure TypeScript.

export type FieldRole =
  'pole' | 'gatePost' | 'gateBar' | 'tower' | 'towerTop' | 'box' | 'ramp' | 'trunk' | 'canopy' | 'flagPole';

interface Base {
  role: FieldRole;
  /** Centre (world, m). */
  position: [number, number, number];
  /** Rotation as a quaternion (x, y, z, w). */
  rotation: [number, number, number, number];
}
export interface BoxPrim extends Base {
  shape: 'box';
  halfExtents: [number, number, number];
}
export interface CylinderPrim extends Base {
  shape: 'cylinder';
  radius: number;
  halfHeight: number;
}
export interface BallPrim extends Base {
  shape: 'ball';
  radius: number;
}
export type FieldPrim = BoxPrim | CylinderPrim | BallPrim;

export interface FlagSpot {
  /** Pole foot (world, m). */
  base: [number, number, number];
  heightM: number;
}

export interface FieldLayout {
  prims: FieldPrim[];
  flags: FlagSpot[];
  /** Gate centres and headings (for tests, HUD and later race timing). */
  gates: { center: [number, number, number]; yaw: number }[];
}

const yawQ = (yaw: number): [number, number, number, number] => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
/** Yaw then pitch about the local X axis. */
function yawPitchQ(yaw: number, pitch: number): [number, number, number, number] {
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  // q = q_yaw ⊗ q_pitch
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}
const DEG = Math.PI / 180;

export function buildFieldLayout(terrain: Terrain, cfg = FIELD_OBJECTS): FieldLayout {
  const prims: FieldPrim[] = [];
  const ground = (x: number, z: number) => terrain.heightAt(x, z);

  // Poles every 20 m, clear of the launch area.
  const P = cfg.poles;
  const half = terrain.size / 2 - P.spacingM;
  for (let x = -half; x <= half + 1e-6; x += P.spacingM)
    for (let z = -half; z <= half + 1e-6; z += P.spacingM) {
      if (Math.hypot(x, z) < P.clearOfPadM) continue;
      prims.push({
        role: 'pole',
        shape: 'cylinder',
        radius: P.radiusM,
        halfHeight: P.heightM / 2,
        position: [x, ground(x, z) + P.heightM / 2, z],
        rotation: [0, 0, 0, 1],
      });
    }

  // Gates on an oval, each facing along the loop.
  const Gc = cfg.gates;
  const gates: FieldLayout['gates'] = [];
  for (let k = 0; k < Gc.count; k++) {
    const a = (k / Gc.count) * Math.PI * 2;
    const cx = Gc.center[0] + Math.cos(a) * Gc.radiiM[0];
    const cz = Gc.center[1] + Math.sin(a) * Gc.radiiM[1];
    // Tangent of the oval → the direction you fly through; the gate plane is perpendicular to it.
    const tx = -Math.sin(a) * Gc.radiiM[0];
    const tz = Math.cos(a) * Gc.radiiM[1];
    const yaw = Math.atan2(tx, tz) + Math.PI / 2;
    const gy = ground(cx, cz);
    const o = Gc.openingM;
    const p = Gc.postM;
    const cl = Gc.clearanceM;
    const right: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
    const postH = cl + o + p;
    for (const s of [-1, 1]) {
      const off = s * (o / 2 + p / 2);
      prims.push({
        role: 'gatePost',
        shape: 'box',
        halfExtents: [p / 2, postH / 2, p / 2],
        position: [cx + right[0] * off, gy + postH / 2, cz + right[1] * off],
        rotation: yawQ(yaw),
      });
    }
    for (const y of [cl - p / 2, cl + o + p / 2])
      prims.push({
        role: 'gateBar',
        shape: 'box',
        halfExtents: [o / 2 + p, p / 2, p / 2],
        position: [cx, gy + y, cz],
        rotation: yawQ(yaw),
      });
    gates.push({ center: [cx, gy + cl + o / 2, cz], yaw });
  }

  // Dive tower + platform.
  const T = cfg.diveTower;
  const tg = ground(T.position[0], T.position[1]);
  prims.push({
    role: 'tower',
    shape: 'box',
    halfExtents: [T.baseM / 2, T.heightM / 2, T.baseM / 2],
    position: [T.position[0], tg + T.heightM / 2, T.position[1]],
    rotation: [0, 0, 0, 1],
  });
  prims.push({
    role: 'towerTop',
    shape: 'box',
    halfExtents: [T.baseM, 0.15, T.baseM],
    position: [T.position[0], tg + T.heightM + 0.15, T.position[1]],
    rotation: [0, 0, 0, 1],
  });

  for (const b of cfg.boxes) {
    const [x, z] = b.at;
    prims.push({
      role: 'box',
      shape: 'box',
      halfExtents: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2],
      position: [x, ground(x, z) + b.size[1] / 2, z],
      rotation: yawQ(b.yawDeg * DEG),
    });
  }

  // Ramps: a slab tilted up to `height` over `length`, its low edge on the ground.
  for (const r of cfg.ramps) {
    const [x, z] = r.at;
    const slope = Math.atan2(r.height, r.length);
    const len = Math.hypot(r.length, r.height);
    const t = 0.25;
    prims.push({
      role: 'ramp',
      shape: 'box',
      halfExtents: [r.width / 2, t / 2, len / 2],
      position: [x, ground(x, z) + r.height / 2 - (t / 2) * Math.cos(slope), z],
      // Rise toward −Z (local), tilted about the local X axis.
      rotation: yawPitchQ(r.yawDeg * DEG, slope),
    });
  }

  // Trees: seeded, in a ring around the launch area.
  const Tr = cfg.trees;
  const rand = mulberry32(Tr.seed);
  for (let k = 0; k < Tr.count; k++) {
    const a = rand() * Math.PI * 2;
    const d = Tr.ringM[0] + rand() * (Tr.ringM[1] - Tr.ringM[0]);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const h = Tr.trunk.heightM[0] + rand() * (Tr.trunk.heightM[1] - Tr.trunk.heightM[0]);
    const c = Tr.canopyM[0] + rand() * (Tr.canopyM[1] - Tr.canopyM[0]);
    const g = ground(x, z);
    prims.push({
      role: 'trunk',
      shape: 'cylinder',
      radius: Tr.trunk.radiusM,
      halfHeight: h / 2,
      position: [x, g + h / 2, z],
      rotation: [0, 0, 0, 1],
    });
    prims.push({ role: 'canopy', shape: 'ball', radius: c, position: [x, g + h + c * 0.6, z], rotation: [0, 0, 0, 1] });
  }

  const flags: FlagSpot[] = cfg.flags.map(([x, z]) => ({ base: [x, ground(x, z), z], heightM: 3 }));
  for (const f of flags)
    prims.push({
      role: 'flagPole',
      shape: 'cylinder',
      radius: 0.025,
      halfHeight: f.heightM / 2,
      position: [f.base[0], f.base[1] + f.heightM / 2, f.base[2]],
      rotation: [0, 0, 0, 1],
    });

  return { prims, flags, gates };
}
