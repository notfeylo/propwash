import { AUDIO } from '../config/audio';
import type { MotorVoice } from './MotorVoice';

/** tanh soft-clip curve for the slight distortion of motor-coil beeps. */
function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  return c;
}

/**
 * Synthesized beeps (PRD §4.5). ESC tones come out of the motors — each is fanned out to
 * all four voices' beep inputs, so it's spatialized at the rotors. The FC piezo and the XT60
 * tick come from a single emitter on the frame.
 */
export class Beeper {
  private curve: Float32Array<ArrayBuffer>;

  constructor(
    private ctx: BaseAudioContext,
    private voices: MotorVoice[],
    private frame: AudioNode,
    private noise: AudioBuffer,
  ) {
    this.curve = driveCurve(AUDIO.beeps.esc.drive);
  }

  private get vol(): number {
    return AUDIO.userVolume.beeps;
  }

  /** One ESC tone through every motor: square → soft-clip → band-pass 1.5–4 kHz. */
  escTone(freqHz: number, start: number, durationS: number): void {
    const e = AUDIO.beeps.esc;
    const osc = new OscillatorNode(this.ctx, { type: 'square', frequency: freqHz });
    const shaper = new WaveShaperNode(this.ctx, { curve: this.curve, oversample: '2x' });
    const band = new BiquadFilterNode(this.ctx, { type: 'bandpass', frequency: e.bandCenterHz, Q: e.bandQ });
    const env = new GainNode(this.ctx, { gain: 0 });
    osc.connect(shaper).connect(band).connect(env);
    for (const v of this.voices) env.connect(v.beepInput);
    const peak = (e.gain * this.vol) / Math.sqrt(this.voices.length || 1);
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + e.attackS);
    env.gain.setValueAtTime(peak, start + durationS - e.releaseS);
    env.gain.linearRampToValueAtTime(0, start + durationS);
    osc.start(start);
    osc.stop(start + durationS + 0.02);
  }

  escSequence(notesHz: readonly number[], noteS: number, start: number): void {
    notesHz.forEach((f, i) => this.escTone(f, start + i * noteS, noteS));
  }

  /** FC piezo: near-sine at its resonance with a hard, clicky envelope. */
  buzz(freqHz: number, start: number, durationS: number): void {
    const b = AUDIO.beeps.buzzer;
    const osc = new OscillatorNode(this.ctx, { type: 'triangle', frequency: freqHz });
    const env = new GainNode(this.ctx, { gain: 0 });
    osc.connect(env).connect(this.frame);
    const peak = b.gain * this.vol;
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + 0.002);
    env.gain.setValueAtTime(peak, start + durationS - 0.004);
    env.gain.linearRampToValueAtTime(0, start + durationS);
    osc.start(start);
    osc.stop(start + durationS + 0.01);
  }

  buzzPattern(count: number, durationS: number, gapS: number, start: number, freqHz = AUDIO.beeps.buzzer.freqHz) {
    for (let i = 0; i < count; i++) this.buzz(freqHz, start + i * (durationS + gapS), durationS);
  }

  /** XT60 plug-in: a bright tick, then a small capacitor pop with a low thump. */
  plugIn(start: number): void {
    const p = AUDIO.beeps.plug;
    const tick = new AudioBufferSourceNode(this.ctx, { buffer: this.noise });
    const hp = new BiquadFilterNode(this.ctx, { type: 'highpass', frequency: 3000 });
    const tg = new GainNode(this.ctx, { gain: 0 });
    tick.connect(hp).connect(tg).connect(this.frame);
    tg.gain.setValueAtTime(p.tickGain * this.vol, start);
    tg.gain.setTargetAtTime(0, start, p.tickS / 3);
    tick.start(start, 0.1);
    tick.stop(start + p.tickS * 4);

    const popAt = start + 0.012;
    const pop = new AudioBufferSourceNode(this.ctx, { buffer: this.noise });
    const bp = new BiquadFilterNode(this.ctx, { type: 'bandpass', frequency: 1200, Q: 0.6 });
    const pg = new GainNode(this.ctx, { gain: 0 });
    pop.connect(bp).connect(pg).connect(this.frame);
    pg.gain.setValueAtTime(p.popGain * this.vol, popAt);
    pg.gain.setTargetAtTime(0, popAt, p.popS / 4);
    pop.start(popAt, 0.7);
    pop.stop(popAt + p.popS * 2);

    const thump = new OscillatorNode(this.ctx, { type: 'sine', frequency: p.thumpHz });
    const thg = new GainNode(this.ctx, { gain: 0 });
    thump.connect(thg).connect(this.frame);
    thg.gain.setValueAtTime(p.popGain * 0.8 * this.vol, popAt);
    thg.gain.setTargetAtTime(0, popAt, p.popS / 3);
    thump.start(popAt);
    thump.stop(popAt + p.popS * 2);
  }
}
