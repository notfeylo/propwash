import { AUDIO } from '../config/audio';
import { buildCrossfadedLoop } from './loopBuilder';

/** Seeded PRNG so procedural buffers are identical on every load. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mono white noise, looped by the air and wind layers. */
export function noiseBuffer(ctx: BaseAudioContext, seconds = 2, seed = 1): AudioBuffer {
  const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  const r = rng(seed);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return b;
}

/**
 * Small-room impulse response: short pre-delay, then decaying stereo noise with a gentle
 * high-frequency roll-off over time. Procedural, so there's nothing to license.
 */
export function roomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const { durationS, decayPower, preDelayS } = AUDIO.room;
  const n = Math.round(ctx.sampleRate * durationS);
  const pre = Math.round(ctx.sampleRate * preDelayS);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    const r = rng(7 + ch);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / (n - pre);
      const env = (1 - t) ** decayPower;
      const k = 0.35 + 0.6 * (1 - t); // darker as it decays
      lp += k * (r() * 2 - 1 - lp);
      d[i] = lp * env;
    }
  }
  return b;
}

/**
 * PeriodicWave with the measured harmonic magnitudes of the recorded steady tone. Each voice
 * gets its own random harmonic phases: four near-unison motors with identical waveforms beat
 * as one comb (deep, simultaneous nulls = phasing); with independent phases each harmonic
 * beats on its own, which keeps the natural shimmer without the hollow dips.
 */
export function bladeWave(ctx: BaseAudioContext, rand: () => number = Math.random): PeriodicWave {
  const h = AUDIO.harmonics;
  const real = new Float32Array(h.length + 1);
  const imag = new Float32Array(h.length + 1);
  h.forEach((a, i) => {
    const phase = rand() * Math.PI * 2;
    real[i + 1] = a * Math.sin(phase);
    imag[i + 1] = a * Math.cos(phase);
  });
  return ctx.createPeriodicWave(real, imag);
}

/** Decode a clip; resolves null if it's missing (procedural-only builds). */
export async function loadClip(ctx: BaseAudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/html')) return null; // SPA fallback, not a clip
    return await ctx.decodeAudioData(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** Mono loop buffer with the equal-power seam (PRD §4.5). */
export function loopBufferFrom(ctx: BaseAudioContext, clip: AudioBuffer): AudioBuffer {
  const mono = new Float32Array(clip.length);
  for (let ch = 0; ch < clip.numberOfChannels; ch++) {
    const d = clip.getChannelData(ch);
    for (let i = 0; i < d.length; i++) mono[i] += d[i] / clip.numberOfChannels;
  }
  const looped = buildCrossfadedLoop(mono, AUDIO.loopCrossfadeS * clip.sampleRate);
  // Match the synth's level so A and B hand off at equal loudness (the recording sits ≈ −23 dBFS).
  let sum = 0;
  for (const v of looped) sum += v * v;
  const gain = AUDIO.layers.A.normalizeRms / Math.sqrt(sum / looped.length || 1);
  for (let i = 0; i < looped.length; i++) looped[i] *= gain;
  const out = ctx.createBuffer(1, looped.length, clip.sampleRate);
  out.copyToChannel(looped, 0);
  return out;
}
