/**
 * Seamless loop from a recording (PRD §4.5): the last `fade` samples are folded into the
 * first `fade` with an equal-power crossfade, and the output is shortened by `fade`.
 *
 *   out[i] = src[i]·sin(π/2·i/F) + src[N−F+i]·cos(π/2·i/F)   for i < F
 *   out[i] = src[i]                                           for F ≤ i < N−F
 *
 * The last output sample is src[N−F−1] and the first is src[N−F] (cos = 1 at i = 0), so
 * wrapping from the end back to the start plays the original, continuous signal.
 */
export function buildCrossfadedLoop(src: Float32Array, fadeSamples: number): Float32Array<ArrayBuffer> {
  const n = src.length;
  const f = Math.max(1, Math.min(Math.floor(fadeSamples), Math.floor(n / 2) - 1));
  const out = new Float32Array(n - f);
  for (let i = 0; i < f; i++) {
    const x = (i / f) * (Math.PI / 2);
    out[i] = src[i] * Math.sin(x) + src[n - f + i] * Math.cos(x);
  }
  out.set(src.subarray(f, n - f), f);
  return out;
}
