/**
 * Seeded randomness for the flight sim (PRD §1: same seed + inputs replay bit-identically).
 * Uses the Phase 1 mulberry32 generator; each consumer gets its own stream so adding noise in one
 * place never shifts another's sequence. The generator state is a plain field (no closure), so a
 * checkpoint can copy it (replays, §8.2).
 */
export class Rng {
  private a: number;
  private spare: number | null = null;

  constructor(readonly seed: number) {
    this.a = seed >>> 0;
  }

  /** mulberry32, the same sequence as the Phase 1 generator. */
  private next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [0, 1). */
  uniform(): number {
    return this.next();
  }

  /** Standard normal (Box–Muller, both halves used). */
  gaussian(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  /** An independent child stream, derived deterministically from this seed and a label. */
  fork(label: string): Rng {
    let h = this.seed ^ 0x9e3779b9;
    for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 0x01000193);
    return new Rng(h >>> 0);
  }
}
