// Blackbox, replay and Flight Lab (Phase 2 PRD §8.2–§8.3).

export const BLACKBOX = {
  /** Logging rate: every other 1 kHz step, like Betaflight's 1/2 blackbox rate at 1 kHz. */
  rateHz: 500,
  /** A recording stops this long after disarming (the crash or landing stays in it). */
  tailS: 3,
  /** Longest recording kept (memory: ≈ 50 channels × 4 B × 500 Hz ≈ 100 KB/s). */
  maxS: 600,
  /** Motor output in the CSV: DShot command range, 48 (0%) to 2047 (100%). */
  dshot: { min: 48, max: 2047 },
  /** Betaflight logs eRPM / 100. */
  erpmScale: 0.01,
};

export const REPLAY = {
  /** Main-thread time per frame spent resimulating a replay ahead of playback (ms). */
  budgetMs: 6,
  speeds: [0.25, 0.5, 1, 2] as const,
};

export const STEP_RESPONSE = {
  /** PIDtoolbox (PTstepcalc) settings: 2 s Hann-windowed segments every 1/20 of a segment. */
  segmentS: 2,
  hopFraction: 1 / 20,
  /** Zero padding each side (samples at 1 kHz; scaled to the log rate). */
  padS: 0.1,
  /** Shown response length (s). */
  responseS: 0.5,
  /** Segments whose setpoint never exceeds this carry no information (deg/s). */
  minSetpointDegS: 20,
  /** Wiener regulariser on the length-normalised spectra. */
  lambda: 1e-4,
  /** Steady-state window (s): each response is scaled to settle at 1 there (Y-correction)… */
  steadyS: [0.2, 0.5] as const,
  /** …and kept only if, before scaling, it stayed inside this band there. */
  steadyBand: [0.5, 3] as const,
};

export const FLIGHT_LAB = {
  /** Live graph window (s) and redraw rate (Hz). */
  liveWindowS: 6,
  liveHz: 15,
  /** Imported logs fly this high over flat ground so the rate loop never meets terrain (m). */
  importAltitudeM: 1500,
};
