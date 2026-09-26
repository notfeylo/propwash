// Camera views, feed styles and OSD (PRD §4.6).

export type CameraMode = 'orbit' | 'fpv' | 'chase' | 'los' | 'hd';
export type FeedStyle = 'analog' | 'digital';
/** HD/GoPro stabilization (Phase 2 §7): raw, smoothed (HyperSmooth-like), or horizon-locked. */
export type HdStabilization = 'raw' | 'smooth' | 'horizon';

/** Views that are a camera on the drone (video look, OSD); the rest are outside views. */
export const isFeedView = (m: CameraMode) => m === 'fpv' || m === 'hd';

const DEG = Math.PI / 180;

export const CAMERAS = {
  order: ['orbit', 'fpv', 'chase', 'los', 'hd'] as CameraMode[],
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

  /** Chase (Phase 2 §7): a spring arm behind and above, looking ahead along the velocity. */
  chase: {
    distanceM: 2.4,
    heightM: 0.8,
    fovDeg: 78,
    /** Aim point leads the drone by this much of its velocity (s), capped (m). */
    lookAheadS: 0.22,
    lookAheadMaxM: 6,
    /** Critically damped spring (rad/s): higher is stiffer. Heading follows its own spring. */
    springRads: 6,
    headingRads: 3,
    /** No-clip: stop this far in front of whatever is between drone and camera (m). */
    clipMarginM: 0.3,
    minAboveGroundM: 0.35,
    /** Jumps farther than this (reset, teleport) snap instead of swinging (m). */
    snapM: 25,
    /** Feed-forward cap on the followed motion (m/s): seeks and resets don't fling it. */
    maxFollowMs: 90,
    near: 0.03,
  },

  /** Line of sight (Phase 2 §7): the pilot on the launch pad, eyes at 1.7 m, tracking with auto-zoom. */
  los: {
    /** Pilot position relative to the pad centre (m); the drone arms facing −Z, away from the pilot. */
    position: [0.9, 1.7, 5] as const,
    /** Auto-zoom: keep a subject this size (m) at `fill` of the frame height, within the FOV range. */
    subjectM: 0.6,
    fill: 0.1,
    fovRangeDeg: [5, 60] as const,
    zoomTauS: 0.6,
    /** Head turn: aim smoothing (s). */
    aimTauS: 0.08,
    near: 0.1,
  },

  hd: {
    hfovDeg: 118,
    /** Stabilization: smoothing time constant and the crop that hides the rotated frame edges. */
    stabilization: {
      default: 'horizon' as HdStabilization,
      smoothTauS: 0.18,
      /** Stabilized views crop in like HyperSmooth / Gyroflow (fraction of the FOV kept). */
      crop: 0.8,
    },
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
