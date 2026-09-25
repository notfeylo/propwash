// Digital filters as Betaflight implements them (fixed sample time).

/** First-order low-pass. */
export class Pt1 {
  private k: number;
  y = 0;

  constructor(
    cutoffHz: number,
    private dt: number,
  ) {
    this.k = Pt1.gain(cutoffHz, dt);
  }

  static gain(cutoffHz: number, dt: number): number {
    const rc = 1 / (2 * Math.PI * cutoffHz);
    return dt / (rc + dt);
  }

  setCutoff(cutoffHz: number): void {
    this.k = Pt1.gain(cutoffHz, this.dt);
  }

  apply(x: number): number {
    this.y += this.k * (x - this.y);
    return this.y;
  }

  reset(v = 0): void {
    this.y = v;
  }
}

/**
 * Third-order low-pass: three cascaded PT1s with the cutoff scaled so the whole filter's −3 dB point
 * stays at `cutoffHz` (Betaflight's PT3).
 */
export class Pt3 {
  private stages: Pt1[];

  constructor(cutoffHz: number, dt: number) {
    const c = cutoffHz / Math.sqrt(2 ** (1 / 3) - 1);
    this.stages = [new Pt1(c, dt), new Pt1(c, dt), new Pt1(c, dt)];
  }

  apply(x: number): number {
    return this.stages.reduce((v, s) => s.apply(v), x);
  }

  get y(): number {
    return this.stages[2].y;
  }

  reset(v = 0): void {
    for (const s of this.stages) s.reset(v);
  }
}

/** PT3 cutoff whose low-frequency group delay is `delayS` (3 stages of 1/(2π f_stage)). */
export function pt3CutoffForDelay(delayS: number): number {
  const stageHz = 3 / (2 * Math.PI * delayS);
  return stageHz * Math.sqrt(2 ** (1 / 3) - 1);
}

/** Biquad notch (RBJ cookbook), retunable every sample like Betaflight's RPM filter. */
export class Notch {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(private dt: number) {}

  /** Centre `hz`, quality `q`. Above Nyquist (or ≤ 0) the notch passes the signal through. */
  set(hz: number, q: number): void {
    const nyquist = 0.5 / this.dt;
    if (hz <= 0 || hz >= nyquist * 0.98) {
      this.b0 = 1;
      this.b1 = this.b2 = this.a1 = this.a2 = 0;
      return;
    }
    const w = 2 * Math.PI * hz * this.dt;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = 1 / a0;
    this.b1 = (-2 * Math.cos(w)) / a0;
    this.b2 = 1 / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  apply(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  reset(v = 0): void {
    this.x1 = this.x2 = this.y1 = this.y2 = v;
  }
}
