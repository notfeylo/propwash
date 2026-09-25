import { RATES, type RateParams, type RatesModel } from '../../config/fc';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Stick (−1..1) → rate (deg/s), Betaflight's four rate models (PRD §3.2), as in its
 * `applyActualRates`, `applyBetaflightRates`, `applyRaceFlightRates` and `applyKissRates`.
 */
export function rate(model: RatesModel, x: number, p: RateParams): number {
  const s = clamp(x, -1, 1);
  const ax = Math.abs(s);
  let r: number;
  switch (model) {
    case 'actual': {
      // expof = |x|·(x⁵·expo + x·(1 − expo)); rate = x·center + max(0, max − center)·expof
      const expof = ax * (s ** 5 * p.c + s * (1 - p.c));
      r = s * p.a + Math.max(0, p.b - p.a) * expof;
      break;
    }
    case 'betaflight': {
      let rc = p.a;
      if (rc > 2) rc += 14.54 * (rc - 2);
      const cmd = p.c ? s * ax ** 3 * p.c + s * (1 - p.c) : s;
      r = 200 * rc * cmd;
      if (p.b) r *= 1 / clamp(1 - Math.abs(cmd) * p.b, 0.01, 1);
      break;
    }
    case 'raceflight': {
      const cmd = (1 + 0.01 * p.c * (s * s - 1)) * s;
      r = cmd * (p.a + Math.abs(cmd) * p.a * p.b * 0.01);
      break;
    }
    case 'kiss': {
      const useRates = 1 / clamp(1 - ax * p.b, 0.01, 1);
      const cmd = (s ** 3 * p.c + s * (1 - p.c)) * (p.a / 10);
      r = 2000 * useRates * cmd;
      break;
    }
  }
  return clamp(r, -RATES.maxDegS, RATES.maxDegS);
}

/** Full-stick rate for a model and its params (deg/s). */
export const maxRate = (model: RatesModel, p: RateParams) => rate(model, 1, p);

/** Stick deflection that gives `degS` (bisection; rates are monotonic). */
export function stickForRate(model: RatesModel, p: RateParams, degS: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rate(model, mid, p) < degS) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
