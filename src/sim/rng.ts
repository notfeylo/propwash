import { mulberry32 } from './MotorModel';

/**
 * Seeded randomness for the flight sim (PRD §1: same seed + inputs replay bit-identically).
 * Uses the Phase 1 mulberry32 generator; each consumer gets its own stream so adding noise in one
 * place never shifts another's sequence.
 */
export class Rng {
  private next: () => number;
  private spare: number | null = null;

  constructor(readonly seed: number) {
    this.next = mulberry32(seed);
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
