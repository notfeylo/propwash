import { HAPTICS } from '../config/input';
import type { PadSnapshot } from './types';

/**
 * Dual-rumble on the active gamepad (Chrome desktop): the weak motor follows motor load, short
 * strong pulses mark ESC beeps and arming. Unsupported pads and browsers are skipped silently.
 */
export class Haptics {
  enabled = HAPTICS.enabled;
  private pulseUntil = 0;
  private lastSent = -Infinity;
  private lastWeak = 0;
  private lastStrong = 0;

  pulse(nowMs: number, ms = HAPTICS.pulseMs): void {
    this.pulseUntil = Math.max(this.pulseUntil, nowMs + ms);
  }

  /** @param load 0..1 motor load (weak motor). */
  update(pad: PadSnapshot | null, nowMs: number, load: number): void {
    const act = pad?.vibrationActuator;
    if (!this.enabled || !act?.playEffect) return;
    const weak = Math.min(1, HAPTICS.weakMax * load);
    const strong = nowMs < this.pulseUntil ? HAPTICS.pulseStrong : 0;
    const idle = weak < 0.005 && strong === 0;
    if (idle && this.lastWeak < 0.005 && this.lastStrong === 0) return;
    const pulseStarted = strong > 0 && this.lastStrong === 0;
    if (strong > 0 && !pulseStarted) return; // the pulse was sent with its full duration
    if (!pulseStarted && nowMs - this.lastSent < HAPTICS.refreshMs) return;
    this.lastSent = nowMs;
    this.lastWeak = weak;
    this.lastStrong = strong;
    const duration = strong > 0 ? Math.max(20, this.pulseUntil - nowMs) : HAPTICS.refreshMs + 60;
    try {
      void act
        .playEffect('dual-rumble', { startDelay: 0, duration, weakMagnitude: weak, strongMagnitude: strong })
        ?.catch?.(() => {});
    } catch {
      this.enabled = false; // this browser exposes the API but refuses the effect
    }
  }
}
