import { STEP_RESPONSE } from '../config/blackbox';

// Step response from flight data (Phase 2 PRD §8.2), the PIDtoolbox way: the gyro is the
// setpoint through an unknown system; Wiener-deconvolve each windowed segment to get its impulse
// response, integrate to a step, keep the segments that settle sensibly, and average.

/** In-place radix-2 FFT (inverse with `inv`). Length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array, inv = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inv)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}

export interface StepResponse {
  /** Time axis (s) and the averaged normalized response (1 = setpoint reached). */
  t: Float64Array;
  y: Float64Array;
  /** Segments used / examined. */
  segments: number;
  examined: number;
  /** Time to first reach 50% and 90% of the final value (s), and the peak overshoot (fraction). */
  delay50: number;
  rise90: number;
  overshoot: number;
}

/** @param sp setpoint (deg/s) @param gyro measured rate (deg/s), same sample rate `rateHz` */
export function stepResponse(sp: ArrayLike<number>, gyro: ArrayLike<number>, rateHz: number): StepResponse | null {
  const S = STEP_RESPONSE;
  const segLen = Math.round(S.segmentS * rateHz);
  const pad = Math.round(S.padS * rateHz);
  const n = 1 << Math.ceil(Math.log2(segLen + 2 * pad));
  const hop = Math.max(1, Math.round(segLen * S.hopFraction));
  const outN = Math.round(S.responseS * rateHz) + 1;
  const ss0 = Math.round(S.steadyS[0] * rateHz);
  const ss1 = Math.min(outN, Math.round(S.steadyS[1] * rateHz));
  const acc = new Float64Array(outN);
  let used = 0;
  let examined = 0;
  const win = new Float64Array(segLen).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (segLen - 1)));
  const sr = new Float64Array(n);
  const si = new Float64Array(n);
  const gr = new Float64Array(n);
  const gi = new Float64Array(n);
  const step = new Float64Array(outN);
  for (let start = 0; start + segLen <= sp.length; start += hop) {
    examined++;
    let peak = 0;
    for (let i = 0; i < segLen; i++) peak = Math.max(peak, Math.abs(sp[start + i]));
    if (peak < S.minSetpointDegS) continue;
    sr.fill(0);
    si.fill(0);
    gr.fill(0);
    gi.fill(0);
    for (let i = 0; i < segLen; i++) {
      sr[pad + i] = (sp[start + i] * win[i]) / n;
      gr[pad + i] = (gyro[start + i] * win[i]) / n;
    }
    fft(sr, si);
    fft(gr, gi);
    // Impulse response H = G·conj(S) / (|S|² + λ)
    for (let i = 0; i < n; i++) {
      const den = sr[i] * sr[i] + si[i] * si[i] + S.lambda;
      const hr = (gr[i] * sr[i] + gi[i] * si[i]) / den;
      const hi = (gi[i] * sr[i] - gr[i] * si[i]) / den;
      gr[i] = hr;
      gi[i] = hi;
    }
    fft(gr, gi, true);
    let sum = 0;
    for (let i = 0; i < outN; i++) step[i] = sum += gr[i];
    let mean = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = ss0; i < ss1; i++) {
      mean += step[i];
      lo = Math.min(lo, step[i]);
      hi = Math.max(hi, step[i]);
    }
    mean /= ss1 - ss0;
    if (!(lo > S.steadyBand[0] && hi < S.steadyBand[1])) continue;
    for (let i = 0; i < outN; i++) acc[i] += step[i] / mean;
    used++;
  }
  if (!used) return null;
  const y = acc.map((v) => v / used);
  const t = new Float64Array(outN).map((_, i) => i / rateHz);
  const first = (f: number) => {
    const i = y.findIndex((v) => v >= f);
    return i < 0 ? NaN : i / rateHz;
  };
  return {
    t,
    y,
    segments: used,
    examined,
    delay50: first(0.5),
    rise90: first(0.9),
    overshoot: Math.max(0, Math.max(...y) - 1),
  };
}
