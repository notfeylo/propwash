import {
  DataTexture,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
} from 'three/webgpu';
import { BENCH } from '../config/render';

// CPU-generated PBR maps for the bench set. Everything is original and seeded, so the
// look is identical on every load and no image files ship for the floor or pad.

export interface PbrMaps {
  map: DataTexture;
  /** ORM layout: R = occlusion (unused, 1), G = roughness, B = metalness. */
  roughnessMap: DataTexture;
  normalMap: DataTexture;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value-noise fBm sampled on a size×size grid, in [0, 1]. */
function fbm(size: number, baseCells: number, octaves: number, rand: () => number, gain = 0.5): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0, cells = baseCells; o < octaves; o++, cells *= 2) {
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    const k = cells / size;
    for (let y = 0; y < size; y++) {
      const gy = y * k;
      const y0 = Math.floor(gy);
      const ty = gy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % cells) * cells;
      const r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const gx = x * k;
        const x0 = Math.floor(gx);
        const tx = gx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % cells;
        const c1 = (x0 + 1) % cells;
        const a = grid[r0 + c0] + (grid[r0 + c1] - grid[r0 + c0]) * sx;
        const b = grid[r1 + c0] + (grid[r1 + c1] - grid[r1 + c0]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Tangent-space normal map from a height field (Sobel), wrapping or clamping at edges. */
function heightToNormal(h: Float32Array, size: number, strength: number, wrap: boolean): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => {
    if (wrap) return h[((y + size) % size) * size + ((x + size) % size)];
    return h[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        at(x + 1, y - 1) +
        2 * at(x + 1, y) +
        at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

function texture(data: Uint8Array, size: number, srgb: boolean, repeat: boolean): DataTexture {
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

/** Tileable poured-concrete floor: aggregate speckle, soft stains, and trowel-level relief. */
export function concreteMaps(): PbrMaps {
  const { textureSize: S, roughness, normalStrength, seed } = BENCH.floor;
  const rand = mulberry32(seed);
  const broad = fbm(S, 4, 3, rand);
  const mid = fbm(S, 24, 4, rand);
  const fine = fbm(S, 256, 2, rand);
  const albedo = new Uint8Array(S * S * 4);
  const rough = new Uint8Array(S * S * 4);
  const height = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const speck = fine[i] > 0.78 ? -0.12 : fine[i] < 0.2 ? 0.07 : 0;
    const stain = Math.max(0, broad[i] - 0.55) * 0.9;
    const v = Math.min(1, Math.max(0, BENCH.floor.albedo + (mid[i] - 0.5) * 0.1 + speck * 0.6 - stain * 0.5));
    albedo[i * 4] = v * 255 * 0.98;
    albedo[i * 4 + 1] = v * 255 * 0.97;
    albedo[i * 4 + 2] = v * 255 * 0.95;
    albedo[i * 4 + 3] = 255;
    const r = roughness[0] + (roughness[1] - roughness[0]) * (0.5 * mid[i] + 0.5 * fine[i]) - stain * 0.25;
    rough[i * 4] = 255;
    rough[i * 4 + 1] = Math.min(1, Math.max(0, r)) * 255;
    rough[i * 4 + 2] = 0;
    rough[i * 4 + 3] = 255;
    height[i] = mid[i] * 0.6 + fine[i] * 0.4;
  }
  return {
    map: texture(albedo, S, true, true),
    roughnessMap: texture(rough, S, false, true),
    normalMap: texture(heightToNormal(height, S, normalStrength, true), S, false, true),
  };
}

/**
 * Worn fabric landing pad (original design): woven base, orange rim, dashed alignment
 * ring, center cross and a nose chevron toward −Z. Texture row 0 is the pad's +Z edge,
 * so the front of the pad is drawn at the bottom of the canvas.
 */
export function landingPadMaps(): PbrMaps {
  const { textureSize: S, radiusM: R, colors, roughness, normalStrength, seed } = BENCH.pad;
  const rand = mulberry32(seed);
  const px = (m: number) => (m / (2 * R)) * S;
  const c = S / 2;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('2D canvas unavailable');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = g.fillStyle = '#fff';
  g.lineCap = 'butt';

  // rim
  g.lineWidth = px(0.02);
  g.beginPath();
  g.arc(c, c, px(0.293), 0, Math.PI * 2);
  g.stroke();
  // dashed alignment ring
  g.lineWidth = px(0.005);
  g.setLineDash([px(0.03), px(0.022)]);
  g.beginPath();
  g.arc(c, c, px(0.2), 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  // center cross with a gap, plus a small ring
  g.lineWidth = px(0.004);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    g.beginPath();
    g.moveTo(c + dx * px(0.045), c + dy * px(0.045));
    g.lineTo(c + dx * px(0.1), c + dy * px(0.1));
    g.stroke();
  }
  g.beginPath();
  g.arc(c, c, px(0.028), 0, Math.PI * 2);
  g.stroke();
  // nose chevron toward −Z (canvas bottom)
  g.beginPath();
  g.moveTo(c - px(0.035), c + px(0.235));
  g.lineTo(c, c + px(0.262));
  g.lineTo(c + px(0.035), c + px(0.235));
  g.lineTo(c + px(0.035), c + px(0.248));
  g.lineTo(c, c + px(0.275));
  g.lineTo(c - px(0.035), c + px(0.248));
  g.closePath();
  g.fill();
  // tick marks every 30° on the rim's inner edge
  g.lineWidth = px(0.003);
  for (let a = 0; a < 12; a++) {
    const t = (a / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(c + Math.cos(t) * px(0.262), c + Math.sin(t) * px(0.262));
    g.lineTo(c + Math.cos(t) * px(0.278), c + Math.sin(t) * px(0.278));
    g.stroke();
  }
  const mask = g.getImageData(0, 0, S, S).data;

  const wear = fbm(S, 32, 4, rand);
  const dust = fbm(S, 6, 3, rand);
  const grit = fbm(S, 512, 1, rand);
  const base = hex(colors.base);
  const weaveC = hex(colors.weave);
  const ring = hex(colors.ring);
  const marks = hex(colors.marks);
  const pitch = px(0.0021);

  const albedo = new Uint8Array(S * S * 4);
  const rough = new Uint8Array(S * S * 4);
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const rM = Math.hypot(x - c, y - c) * ((2 * R) / S);
      // basket weave: alternating over/under threads
      const wx = Math.sin((x / pitch) * Math.PI);
      const wy = Math.sin((y / pitch) * Math.PI);
      const weave = 0.5 + 0.5 * (Math.floor(x / pitch + y / pitch) % 2 === 0 ? wx * wx : wy * wy);
      // paint chips away where wear noise is low, more toward the rim
      const paint = (mask[i * 4] / 255) * (wear[i] > 0.34 + rM * 0.35 ? 1 : 0.15);
      const paintColor = rM > 0.27 ? ring : marks;
      const dusty = Math.max(0, dust[i] - 0.45) * 0.6 + (grit[i] > 0.85 ? 0.08 : 0);
      for (let k = 0; k < 3; k++) {
        const fabric = base[k] + (weaveC[k] - base[k]) * weave;
        const v = fabric + (paintColor[k] - fabric) * paint;
        albedo[i * 4 + k] = Math.min(255, v + dusty * 120);
      }
      albedo[i * 4 + 3] = 255;
      const r = roughness.fabric + (roughness.paint - roughness.fabric) * paint + dusty * 0.1;
      rough[i * 4] = 255;
      rough[i * 4 + 1] = Math.min(1, r) * 255;
      rough[i * 4 + 2] = 0;
      rough[i * 4 + 3] = 255;
      height[i] = weave * (1 - paint * 0.7) * 0.5 + paint * 0.35;
    }
  }
  return {
    map: texture(albedo, S, true, false),
    roughnessMap: texture(rough, S, false, false),
    normalMap: texture(heightToNormal(height, S, normalStrength, false), S, false, false),
  };
}
