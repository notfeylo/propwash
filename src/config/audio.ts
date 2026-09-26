// Audio tunables (PRD §4.5). Every tone frequency and duration lives here so it can be
// matched against real recordings later.

const note = { C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98 };

export const AUDIO = {
  /** Clips cut by `pnpm assets` from the (git-ignored) recording. Absent → procedural-only. */
  clips: {
    loop: '/audio/motor_loop.wav',
    spoolUp: '/audio/spoolup.m4a',
    spoolDown: '/audio/spooldown.m4a',
  },
  /** Equal-power overlap of the loop's tail into its head (s). */
  loopCrossfadeS: 0.3,
  /**
   * Fundamental of the recorded steady tone, which the PRD maps to MOTOR.rpmHover. Every tonal
   * layer is pitched from this reference so the recording and the synth agree (see DECISIONS).
   */
  f0AtHoverHz: 294.7,
  /** Measured harmonic amplitudes of the steady tone, relative to f₀ (harmonics 1–10). */
  harmonics: [1.0, 0.768, 0.408, 0.255, 0.237, 0.248, 0.163, 0.115, 0.092, 0.128],
  /** Smoothing for per-frame parameter updates (s): no zipper noise, no audible lag. */
  paramSmoothingS: 0.012,

  layers: {
    /** A — recorded body. */
    A: {
      /** The loop is normalized to this RMS at load: about a PeriodicWave's (peak-normalized) RMS. */
      normalizeRms: 0.4,
      /** Same as B's procedural gain, so recording and synth are equally loud. */
      gain: 0.34,
      rateMin: 0.35,
      rateMax: 2.2,
      exponent: 1.2,
      /** Full weight inside this playback-rate range; fades to 0 at rateMin/rateMax. */
      cleanRate: [0.6, 1.6] as const,
    },
    /** B — blade-pass tone (PeriodicWave from the measured harmonics). */
    B: {
      /** With the recording present B supports A; `fill` covers A where A fades out. */
      gain: 0.1,
      fill: 0.3,
      /** Procedural-only: B carries the tonal body. */
      proceduralGain: 0.34,
      exponent: 1.2,
      /** Rises steeply just above idle. */
      onsetRpm: [900, 3200] as const,
    },
    /** C — motor whine at the electrical frequency, rpm/60 × pole pairs. */
    C: {
      /** ≈ −30 dB relative to the tonal body at hover. */
      gain: 0.011,
      harmonic2: 0.35,
      /** Extra level at low RPM (bench): ×(1 + lowRpmBoost) fading out by lowRpmFadeRpm. */
      lowRpmBoost: 2,
      lowRpmFadeRpm: 12000,
      onsetRpm: [150, 1200] as const,
    },
    /** D — air / prop wash: white noise → band-pass tracking RPM. */
    D: {
      /** Before motorTrim; ≈ −6 dB under the tonal body at full throttle. */
      gain: 1.6,
      centerHz: [600, 4000] as const,
      q: 0.7,
    },
    /** E — transients ("fast reflexes") on hard RPM changes while driven. */
    E: {
      thresholdRpmPerS: 25000,
      /** Rate at which a transient reaches full strength. */
      fullRpmPerS: 300000,
      durationS: [0.06, 0.18] as const,
      /** Before motorTrim; puts a full-strength rip at about the level of the motor body. */
      gain: 3.2,
      bandHz: 1800,
      q: 0.8,
      /** Pitch overshoot on layer B at full strength (fraction). */
      pitchOvershoot: 0.08,
      refractoryS: 0.22,
    },
  },

  /** Spool one-shots (recording path only): rate-matched to the motor, then handed to the loop. */
  spool: {
    /** Pitch at the start/end of each clip (Hz), from the PRD timeline. */
    upPitchHz: [180, 295] as const,
    upDurationS: 2.5,
    downPitchHz: [290, 180] as const,
    downDurationS: 2.7,
    /** Spool-down plays when disarming above this RPM. */
    downMinRpm: 4000,
    /** Spool-up plays for this long after arming from rest before crossfading to the loop. */
    upHoldS: 0.35,
    crossfadeS: 0.15,
    gain: 0.5,
  },

  master: {
    gain: 0.8,
    /**
     * Trim on each motor voice (layers A–E, not beeps). The four voices sit near unison and sum
     * almost coherently, so without it the bus runs into the compressor and flattens the RPM →
     * loudness curve. With it: idle ≈ −32, hover ≈ −20, full ≈ −10 dBFS at the default camera.
     */
    motorTrim: 0.4,
    /** Gentle: only catches peaks, so loudness keeps tracking RPM. */
    compressor: { threshold: -12, knee: 8, ratio: 2.5, attack: 0.01, release: 0.25 },
  },
  /** Small-room reverb from a procedural impulse response (bench scene only). */
  room: { enabled: true, wet: 0.1, durationS: 0.35, decayPower: 3.5, preDelayS: 0.006 },
  panner: { refDistance: 0.25, maxDistance: 40, rolloffFactor: 1 },
  /** Orbit view: low-pass tracking camera distance (air absorption). */
  airAbsorption: { nearM: 0.3, farM: 3, nearHz: 20000, farHz: 6500 },
  /** FPV view: close, bright mic plus low wind rumble from prop wash. */
  fpv: { highShelfHz: 5000, highShelfDb: 4, windLowpassHz: 180, windGain: 0.35 },

  beeps: {
    /** ESC tones play through the motors: square → slight drive → band-pass 1.5–4 kHz. */
    esc: { bandCenterHz: 2450, bandQ: 0.9, drive: 2.5, gain: 0.3, attackS: 0.004, releaseS: 0.012 },
    /** ESC power-on: three ascending tones. */
    powerOn: { notesHz: [note.C6, note.E6, note.G6], noteS: 0.15 },
    /** Signal detected: two tones, low → high. */
    signal: { notesHz: [note.D6, note.G6], noteS: 0.12 },
    /** DShot beacon through the motors, once per second. */
    beacon: { freqHz: note.E6, durationS: 0.25, periodS: 1 },
    /** FC piezo buzzer (~4 kHz resonance). */
    buzzer: {
      freqHz: 4000,
      gain: 0.12,
      armChirp: { enabled: true, durationS: 0.04 },
      disarm: { count: 2, durationS: 0.08, gapS: 0.08 },
      refused: { freqHz: 2200, durationS: 0.6 },
      lowBattery: { count: 2, durationS: 0.1, gapS: 0.1, periodS: 1.5 },
    },
    /** XT60 plug-in: sharp tick + small capacitor pop. */
    plug: { tickS: 0.004, tickGain: 0.5, popS: 0.035, popGain: 0.35, thumpHz: 110 },
  },

  /** Phase 2 §6: F — wind / air rush, noise ∝ airspeed², band-passed; louder in FPV (mic on the drone). */
  wind: { gain: 0.5, refMs: 30, maxGain: 0.6, centerHz: [300, 1800] as const, q: 0.6, fpvBoost: 1.6, orbitFalloffM: 6 },
  /** Prop wash chop: amplitude modulation of layers A and D at 10–30 Hz, depth ∝ wash severity. */
  chop: { depth: 0.75, hz: [10, 30] as const, wanderPerS: 6 },
  /** Doppler in the outside views (orbit; chase and LOS later): pitch × c / (c + v_away). */
  doppler: { speedOfSoundMs: 343, maxShift: 0.25 },
  /** Impacts through the frame: grass thud, hard knock, carbon crack; level ∝ log(g). */
  impact: {
    minG: 3,
    fullG: 200,
    refractoryS: 0.08,
    gain: 0.9,
    grass: { lowpassHz: 260, durationS: 0.18 },
    hard: { bandHz: 1100, q: 1.2, durationS: 0.1 },
    crack: { highpassHz: 2600, durationS: 0.03, gain: 0.5 },
  },
  /** Prop strike: a sharp tick from that motor; a severe one at speed adds an ESC desync screech. */
  propStrike: {
    tickHz: 3200,
    tickS: 0.012,
    gain: 0.6,
    desyncMinRpm: 8000,
    desyncS: 0.16,
    desyncHz: [1800, 3600] as const,
  },
  /** Turtle mode: reversed props at high torque, strained and buzzy. */
  turtle: { whineBoost: 5, bladeCut: 0.6, airBoost: 1.3 },

  /** Per-layer user volume (Settings, Task 8). */
  userVolume: { A: 1, B: 1, C: 1, D: 1, E: 1, beeps: 1 },
};

export type AudioLayer = keyof typeof AUDIO.userVolume;
