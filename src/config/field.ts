// Minimal flight test field (Phase 2 PRD §5): depth cues and things to fly around, not the
// Phase 3 world. Metres; world origin = the launch pad, nose of the drone toward −Z at spawn.

export const TERRAIN = {
  sizeM: 600,
  /** Heightfield cells per side (physics and render share the same grid). */
  cells: 200,
  /** Gentle hills: sum of octaves of seeded value noise. */
  seed: 1337,
  octaves: [
    { wavelengthM: 220, amplitudeM: 9 },
    { wavelengthM: 90, amplitudeM: 3.5 },
    { wavelengthM: 35, amplitudeM: 0.8 },
  ],
  /** Flat launch area around the pad: fully flat inside, blending to the hills by the outer radius. */
  launchFlat: { innerM: 25, outerM: 60 },
  /** Grass colour variation (linear sRGB). */
  colors: { dry: [0.23, 0.26, 0.11] as const, lush: [0.1, 0.2, 0.06] as const, dirt: [0.2, 0.16, 0.1] as const },
};

export const FIELD_OBJECTS = {
  /** Vertical reference poles on a 20 m grid (skipping the launch area). */
  poles: { spacingM: 20, heightM: 3, radiusM: 0.05, clearOfPadM: 12 },
  /** Six race gates (inner opening 1.5 × 1.5 m, MultiGP-style) on an oval loop. */
  gates: { count: 6, center: [0, -45] as const, radiiM: [26, 16] as const, openingM: 1.5, postM: 0.1, clearanceM: 0.3 },
  /** The dive tower: 40 m, with a small platform on top. */
  diveTower: { position: [55, 30] as const, heightM: 40, baseM: 3 },
  /** Proximity boxes and ramps (x, z, size or length/width/height, yaw deg). */
  boxes: [
    { at: [14, -12], size: [1.2, 1.2, 1.2], yawDeg: 20 },
    { at: [18, -8], size: [2, 2.5, 2], yawDeg: 0 },
    { at: [-16, -14], size: [3, 1, 1.5], yawDeg: 35 },
    { at: [-22, 6], size: [1.5, 3, 1.5], yawDeg: 10 },
    { at: [24, 14], size: [4, 2, 4], yawDeg: 45 },
  ] as { at: [number, number]; size: [number, number, number]; yawDeg: number }[],
  ramps: [
    // In the oval's infield, clear of the racing line through the gates.
    { at: [0, -45], length: 8, width: 3, height: 2.5, yawDeg: 90 },
    { at: [30, -20], length: 10, width: 4, height: 3.5, yawDeg: -60 },
  ] as { at: [number, number]; length: number; width: number; height: number; yawDeg: number }[],
  /** Trees scattered outside the launch area. */
  trees: {
    count: 16,
    seed: 42,
    ringM: [35, 160] as const,
    trunk: { heightM: [3, 6] as const, radiusM: 0.18 },
    canopyM: [1.8, 3.2] as const,
  },
  /** Wind flags near the launch area: they point downwind and stream with speed. */
  flags: [
    [6, 4],
    [-7, 3],
    [0, -9],
  ] as [number, number][],
};

export const FIELD_RENDER = {
  /** Instanced grass cards around the camera only. */
  grass: { radiusM: 14, cellM: 0.22, bladeHeightM: [0.06, 0.16] as const, maxBlades: 14000 },
  /** Distance fog toward the sky's horizon colour. */
  fog: { nearM: 180, farM: 1300, color: 0xc4d0dc },
  /** Physical sky (sun + atmosphere). */
  sky: {
    turbidity: 3,
    rayleigh: 1.4,
    mieCoefficient: 0.004,
    mieDirectionalG: 0.85,
    sunElevationDeg: 38,
    sunAzimuthDeg: 135,
    /** Scales the sky's HDR radiance so it stays under the bloom threshold (only the sun glows). */
    exposure: 0.22,
  },
  /** Far planes once the field is up (m). */
  farM: 1500,
};
