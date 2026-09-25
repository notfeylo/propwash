import { AUDIO } from '../config/audio';
import { DRONE } from '../config/drone';
import { MOTOR } from '../config/motor';

export interface VoiceParams {
  /** Layer A playback rate and gain (gain 0 without the recording). */
  aRate: number;
  aGain: number;
  /** Layer B fundamental and gain. */
  bHz: number;
  bGain: number;
  /** Layer C (electrical) fundamental and gain. */
  cHz: number;
  cGain: number;
  /** Layer D band-pass centre and gain. */
  dHz: number;
  dGain: number;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Perceived fundamental: the recording's f₀ scaled by RPM relative to hover. */
export const fundamentalHz = (rpm: number) => (AUDIO.f0AtHoverHz * Math.max(0, rpm)) / MOTOR.rpmHover;

/** Motor electrical frequency: rpm/60 × pole pairs. */
export const electricalHz = (rpm: number) => (Math.max(0, rpm) / 60) * MOTOR.polePairs;

/**
 * Layer A's weight: 1 inside the clean playback-rate range, fading to 0 exactly where the rate
 * clamps, so A never plays at a pitch that disagrees with the motor.
 */
export function recordingWeight(rate: number): number {
  const { rateMin, rateMax, cleanRate } = AUDIO.layers.A;
  return smoothstep(rateMin, cleanRate[0], rate) * (1 - smoothstep(cleanRate[1], rateMax, rate));
}

/** Per-voice layer parameters for one motor's RPM (PRD §4.5 table). */
export function voiceParams(rpm: number, hasRecording: boolean): VoiceParams {
  const r = Math.max(0, rpm);
  const { A, B, C, D } = AUDIO.layers;
  const rel = r / MOTOR.rpmHover;
  const rawRate = rel;
  const aRate = Math.min(A.rateMax, Math.max(A.rateMin, rawRate));
  const aWeight = hasRecording ? recordingWeight(rawRate) : 0;
  const aGain = A.gain * rel ** A.exponent * aWeight;

  const onset = smoothstep(B.onsetRpm[0], B.onsetRpm[1], r);
  const bLevel = hasRecording ? B.gain + B.fill * (1 - aWeight) : B.proceduralGain;
  const bGain = bLevel * rel ** B.exponent * onset;

  const lowBoost = 1 + C.lowRpmBoost * (1 - smoothstep(MOTOR.rpmIdle, C.lowRpmFadeRpm, r));
  const cGain = C.gain * lowBoost * smoothstep(C.onsetRpm[0], C.onsetRpm[1], r);

  const load = Math.min(1, r / DRONE.rpmMax);
  const [lo, hi] = D.centerHz;
  const dHz = lo * (hi / lo) ** load;
  const dGain = D.gain * load ** 2;

  return { aRate, aGain, bHz: fundamentalHz(r), bGain, cHz: electricalHz(r), cGain, dHz, dGain };
}

/** Transient strength 0..1 for an RPM rate of change (RPM/s); 0 below the threshold. */
export function transientStrength(rpmPerS: number): number {
  const { thresholdRpmPerS: t, fullRpmPerS: f } = AUDIO.layers.E;
  const x = Math.abs(rpmPerS);
  return x <= t ? 0 : Math.min(1, Math.sqrt((x - t) / (f - t)));
}
