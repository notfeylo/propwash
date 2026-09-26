import { TERRAIN } from '../config/field';
import { mulberry32 } from '../sim/MotorModel';

// The test field's ground (Phase 2 PRD §5), shared by physics (Rapier heightfield) and render.
// Pure TypeScript: no three.js, no DOM.

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Seeded 2D value noise on a lattice of `cell` metres, −1..1. */
function valueNoise(seed: number) {
  const rand = mulberry32(seed);
  const N = 256;
  const table = Float32Array.from({ length: N * N }, () => rand() * 2 - 1);
  const at = (i: number, j: number) => table[(((i % N) + N) % N) * N + (((j % N) + N) % N)];
  return (x: number, z: number, cell: number) => {
    const fx = x / cell;
    const fz = z / cell;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = smooth(fx - i);
    const v = smooth(fz - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}

/**
 * A square heightfield of `cells`² quads centred on the origin. Each quad is two triangles split
 * along the (ix, iz)–(ix+1, iz+1) diagonal, as Rapier's heightfield does, so the render mesh, the
 * collider and `heightAt` describe exactly the same surface.
 */
export class Terrain {
  readonly size = TERRAIN.sizeM;
  readonly cells = TERRAIN.cells;
  /** (cells+1)² heights, row-major: index = iz * (cells+1) + ix, x and z from −size/2. */
  readonly heights: Float32Array;

  constructor(cfg = TERRAIN) {
    const n = cfg.cells + 1;
    const noise = cfg.octaves.map((_, k) => valueNoise(cfg.seed + k * 101));
    this.heights = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++)
      for (let ix = 0; ix < n; ix++) {
        const x = -cfg.sizeM / 2 + (ix / cfg.cells) * cfg.sizeM;
        const z = -cfg.sizeM / 2 + (iz / cfg.cells) * cfg.sizeM;
        let h = 0;
        cfg.octaves.forEach((o, k) => (h += noise[k](x, z, o.wavelengthM) * o.amplitudeM));
        // Hills only outside the launch area; the pad sits on flat ground at y = 0.
        const r = Math.hypot(x, z);
        const { innerM, outerM } = cfg.launchFlat;
        const w = smooth(Math.min(1, Math.max(0, (r - innerM) / (outerM - innerM))));
        this.heights[iz * n + ix] = h * w;
      }
  }

  get cellM(): number {
    return this.size / this.cells;
  }

  /** Ground height at (x, z) on the triangulated surface (m). Outside the field: the edge height. */
  heightAt(x: number, z: number): number {
    const n = this.cells + 1;
    const fx = Math.min(this.cells - 1e-6, Math.max(0, (x + this.size / 2) / this.cellM));
    const fz = Math.min(this.cells - 1e-6, Math.max(0, (z + this.size / 2) / this.cellM));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const u = fx - ix;
    const v = fz - iz;
    const h = this.heights;
    const h00 = h[iz * n + ix];
    const h10 = h[iz * n + ix + 1];
    const h01 = h[(iz + 1) * n + ix];
    const h11 = h[(iz + 1) * n + ix + 1];
    // Triangles (00, 10, 11) where u ≥ v and (00, 11, 01) where u < v.
    return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v;
  }

  /** Surface normal at (x, z) from the height gradient. */
  normalAt(x: number, z: number): [number, number, number] {
    const e = this.cellM * 0.5;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    const l = Math.hypot(dx, 1, dz);
    return [-dx / l, 1 / l, -dz / l];
  }
}
