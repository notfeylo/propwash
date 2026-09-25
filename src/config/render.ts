// Tunable renderer, lighting, post and bench-set values (PRD §4.2).

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
export type BackgroundMode = 'gradient' | 'hdri';

export interface QualitySettings {
  /** Cap on devicePixelRatio before the dynamic resolution scale is applied. */
  maxPixelRatio: number;
  shadowMapSize: number;
  ao: boolean;
  aoSamples: number;
  /** GTAO render scale relative to the scene pass. */
  aoResolutionScale: number;
  bloom: boolean;
}

export const QUALITY: Record<QualityPreset, QualitySettings> = {
  low: { maxPixelRatio: 1, shadowMapSize: 1024, ao: false, aoSamples: 8, aoResolutionScale: 0.5, bloom: false },
  medium: { maxPixelRatio: 1.25, shadowMapSize: 2048, ao: true, aoSamples: 8, aoResolutionScale: 0.5, bloom: true },
  high: { maxPixelRatio: 1.5, shadowMapSize: 2048, ao: true, aoSamples: 16, aoResolutionScale: 0.5, bloom: true },
  ultra: { maxPixelRatio: 2, shadowMapSize: 4096, ao: true, aoSamples: 16, aoResolutionScale: 1, bloom: true },
};

export const QUALITY_AUTO = {
  /** Preset used while the first frames are measured. */
  initial: 'high' as QualityPreset,
  /** Frames skipped before measuring (shader compiles, texture uploads). */
  warmupFrames: 20,
  sampleFrames: 120,
  /** Median frame-time (ms) thresholds for the pick. */
  lowAboveMs: 30,
  mediumAboveMs: 21,
  ultraBelowMs: 9,
};

export const DYNAMIC_RESOLUTION = {
  enabled: true,
  min: 0.6,
  max: 1,
  step: 0.05,
  /** Median frame time above this steps the scale down. */
  downAboveMs: 19,
  /** Median frame time below this steps it back up (60 Hz vsync sits at 16.7). */
  upBelowMs: 17.5,
  intervalS: 1,
};

export const RENDER = {
  exposure: 1.0,
  camera: { fov: 40, near: 0.01, far: 60, position: [0.42, 0.26, 0.5] as const },
  orbit: { minDistance: 0.25, maxDistance: 3, damping: 0.08, autoRotateSpeed: 0.4 },
  /** Largest simulation step per frame; longer gaps (tab switches, hitches) are clamped. */
  maxFrameDtS: 0.1,
} as const;

export const ENVIRONMENT = {
  /** Also preloaded in index.html; keep the two in sync. */
  hdriUrl: '/hdri/studio_small_09_1k.hdr',
  intensity: 0.9,
  /** Yaw of the HDRI (radians) so the main softbox sits camera-left of the default view. */
  rotationY: 1.9,
  background: 'gradient' as BackgroundMode,
  hdriBackground: { blurriness: 0.45, intensity: 0.5 },
  /** Linear-sRGB gradient, bottom → top of the viewport. */
  gradient: { bottom: 0x0d0f12, top: 0x2a2e35 },
  /** The floor fades into whatever background is behind it, by distance from the pad (m). */
  horizonFog: { startM: 1.2, endM: 6, floorBandM: [0.02, 0.3] as const },
  /** In flight the whole bench floor stays visible for motion cues (until the group 3 test field). */
  flightFloorFade: { startM: 5, endM: 7.9 },
};

export const LIGHTS = {
  key: {
    color: 0xfff4e8,
    intensity: 2.2,
    /** Offset from the drone toward the light. */
    position: [1.1, 2.2, 0.9] as const,
    shadowHalfExtentM: 0.6,
    shadowNear: 0.5,
    shadowFar: 6,
    shadowBias: -0.0002,
    shadowNormalBias: 0.002,
    shadowRadius: 3,
  },
};

export const POST = {
  ao: { radius: 0.12, thickness: 0.6, distanceExponent: 1.2, scale: 1.0 },
  /** High threshold: only LEDs and hot specular glow. Linear HDR, before tone mapping. */
  bloom: { strength: 0.35, radius: 0.35, threshold: 1.6 },
};

export const BENCH = {
  floor: {
    radiusM: 8,
    tileM: 1.6,
    textureSize: 1024,
    /** Mean sRGB albedo; sealed mid-grey concrete. */
    albedo: 0.24,
    roughness: [0.62, 0.86] as const,
    normalStrength: 0.3,
    seed: 7,
  },
  pad: {
    radiusM: 0.32,
    thicknessM: 0.004,
    textureSize: 2048,
    seed: 11,
    colors: { base: '#1b1d20', weave: '#25282c', ring: '#e2702c', marks: '#c9ccd1', side: '#101113' },
    roughness: { fabric: 0.92, paint: 0.62 },
    normalStrength: 2.2,
  },
};
