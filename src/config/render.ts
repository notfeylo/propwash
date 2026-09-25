// Tunable renderer / viewer values. Task 2 replaces the placeholder bench lighting.
export const RENDER = {
  maxPixelRatio: 2,
  background: 0x0b0d10,
  exposure: 1.0,
  camera: { fov: 40, near: 0.01, far: 100, position: [0.36, 0.22, 0.42] as const },
  orbit: { minDistance: 0.25, maxDistance: 3, damping: 0.08 },
  light: {
    hemisphere: { sky: 0xdfe8ff, ground: 0x30281f, intensity: 1.2 },
    key: { color: 0xffffff, intensity: 2.5, position: [1.5, 2.5, 1.2] as const },
  },
} as const;
