// Camera views, feed styles and OSD (PRD §4.6).

export type CameraMode = 'orbit' | 'fpv' | 'hd';
export type FeedStyle = 'analog' | 'digital';

const DEG = Math.PI / 180;

export const CAMERAS = {
  order: ['orbit', 'fpv', 'hd'] as CameraMode[],
  /** Switch: a quick dip through black, optionally with a whip-pan smear. */
  cut: { durationS: 0.15, whipPan: false, whipAmount: 0.18 },

  fpv: {
    /** Rendered horizontal FOV (rectilinear), before the barrel pass. */
    hfovDeg: 125,
    /** Barrel strength: centre magnified, lines bow outward like a ≈155° fisheye. */
    barrelK: 0.38,
    uptiltDeg: 25,
    uptiltRangeDeg: [0, 50] as const,
    near: 0.001,
    far: 200,
    defaultFeed: 'analog' as FeedStyle,
  },

  analog: {
    aspect: 4 / 3,
    /** Film-grain-like noise amplitude (display space). */
    noise: 0.06,
    /** Scanline depth and line count (PAL-ish). */
    scanlines: { depth: 0.12, lines: 288 },
    /** Chroma bleed: horizontal R/B offset as a fraction of the frame width. */
    chromaShift: 0.0022,
    vignette: 0.45,
    /** Slight softness of analog video: blur radius (px) and blend. */
    blurPx: 0.8,
    softness: 0.35,
    /** Breakup driven by link quality (1 = perfect). The RSSI model arrives later. */
    breakup: { tearLines: 0.08, snow: 0.9 },
  },

  digital: {
    aspect: 16 / 9,
    /** Unsharp-mask amount (DJI O3/O4-like mild sharpening). */
    sharpen: 0.35,
    vignette: 0.15,
  },

  hd: {
    hfovDeg: 118,
    barrelK: 0.2,
    aspect: 16 / 9,
    /** Downward tilt of the action cam on its mount. */
    tiltDeg: 5,
    near: 0.005,
    far: 200,
    sharpen: 0.2,
    /** Rolling-shutter "jello" from frame vibration (off by default). */
    jello: { enabled: false, amount: 0.004, bands: 9 },
    vignette: 0.2,
  },
};

export const OSD = {
  /** Character grid (PAL analog; DJI-style HD has more, finer cells). */
  analogGrid: { cols: 30, rows: 16 },
  digitalGrid: { cols: 53, rows: 20 },
  /** Phase 1 has no link model: fixed healthy values. */
  rssi: 99,
  lq: 100,
  /** Blink rate of warnings (Hz). */
  blinkHz: 2,
  /** Glyph colours: white with a dark outline like MAX7456 / DJI fonts. */
  color: '#ffffff',
  outline: 'rgba(0,0,0,0.85)',
  warnColor: '#ffffff',
  /** Warnings shown at the centre, in priority order, when active. */
  font: '"Consolas", "DejaVu Sans Mono", ui-monospace, monospace',
};

export const HD_REC = { dotColor: '#ff3b30', blinkHz: 1 };

export const toRad = (deg: number) => deg * DEG;
