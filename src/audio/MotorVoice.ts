import { AUDIO } from '../config/audio';
import { MOTOR } from '../config/motor';
import { bladeWave } from './buffers';
import { fundamentalHz, transientStrength, voiceParams } from './voiceMapping';

export interface VoiceResources {
  noise: AudioBuffer;
  loop: AudioBuffer | null;
  spoolUp: AudioBuffer | null;
  spoolDown: AudioBuffer | null;
}

interface SpoolShot {
  kind: 'up' | 'down';
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** Seconds into the clip. */
  pos: number;
  /** Seconds since it started. */
  age: number;
  fading: boolean;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));

/**
 * One motor's sound (PRD §4.5), placed at its rotor with an HRTF panner:
 *   A recorded loop · B blade-pass PeriodicWave · C electrical whine · D air noise ·
 *   E transients · ESC beeps (the motor coils are the speaker) · spool one-shots.
 */
export class MotorVoice {
  readonly panner: PannerNode;
  /** ESC tones are fed here so they come out of this motor. */
  readonly beepInput: GainNode;
  private sum: GainNode;
  private aSrc: AudioBufferSourceNode | null = null;
  private aGain: GainNode;
  private aDuck: GainNode;
  private bOsc: OscillatorNode;
  private bGain: GainNode;
  private cOsc: OscillatorNode;
  private cOsc2: OscillatorNode;
  private cGain: GainNode;
  private dSrc: AudioBufferSourceNode;
  private dFilter: BiquadFilterNode;
  private dGain: GainNode;
  private spool: SpoolShot | null = null;
  private sinceTransient = Infinity;
  private bOvershoot = 0;
  private bOvershootTau = 0.05;
  private lastRpm = 0;

  constructor(
    private ctx: BaseAudioContext,
    destination: AudioNode,
    private res: VoiceResources,
    rand: () => number = Math.random,
  ) {
    const c = ctx;
    this.panner = new PannerNode(c, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: AUDIO.panner.refDistance,
      maxDistance: AUDIO.panner.maxDistance,
      rolloffFactor: AUDIO.panner.rolloffFactor,
    });
    this.panner.connect(destination);
    this.sum = new GainNode(c, { gain: AUDIO.master.motorTrim });
    this.sum.connect(this.panner);
    this.beepInput = new GainNode(c, { gain: 1 });
    this.beepInput.connect(this.panner);

    // A: recorded loop, random start so the four voices never phase-lock.
    this.aDuck = new GainNode(c, { gain: 1 });
    this.aGain = new GainNode(c, { gain: 0 });
    this.aGain.connect(this.aDuck).connect(this.sum);
    if (res.loop) {
      this.aSrc = new AudioBufferSourceNode(c, { buffer: res.loop, loop: true });
      this.aSrc.connect(this.aGain);
      this.aSrc.start(0, rand() * res.loop.duration);
    }

    // B: blade-pass tone.
    this.bOsc = new OscillatorNode(c, { frequency: 1 });
    this.bOsc.setPeriodicWave(bladeWave(c, rand));
    this.bGain = new GainNode(c, { gain: 0 });
    this.bOsc.connect(this.bGain).connect(this.sum);
    this.bOsc.start();

    // C: electrical whine, sine + 2nd harmonic.
    this.cGain = new GainNode(c, { gain: 0 });
    this.cOsc = new OscillatorNode(c, { type: 'sine', frequency: 1 });
    this.cOsc2 = new OscillatorNode(c, { type: 'sine', frequency: 2 });
    const c2 = new GainNode(c, { gain: AUDIO.layers.C.harmonic2 });
    this.cOsc.connect(this.cGain);
    this.cOsc2.connect(c2).connect(this.cGain);
    this.cGain.connect(this.sum);
    this.cOsc.start();
    this.cOsc2.start();

    // D: air / prop wash.
    this.dSrc = new AudioBufferSourceNode(c, { buffer: res.noise, loop: true });
    this.dFilter = new BiquadFilterNode(c, { type: 'bandpass', frequency: 600, Q: AUDIO.layers.D.q });
    this.dGain = new GainNode(c, { gain: 0 });
    this.dSrc.connect(this.dFilter).connect(this.dGain).connect(this.sum);
    this.dSrc.start(0, rand() * res.noise.duration);
  }

  setPosition(x: number, y: number, z: number): void {
    const p = this.panner;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
    }
  }

  private set(param: AudioParam, value: number, now: number): void {
    param.setTargetAtTime(value, now, AUDIO.paramSmoothingS);
  }

  /** Layer E: filtered-noise burst plus a short pitch overshoot on B. */
  private transient(strength: number, direction: number, now: number): void {
    const E = AUDIO.layers.E;
    const dur = lerp(E.durationS[0], E.durationS[1], strength);
    const src = new AudioBufferSourceNode(this.ctx, { buffer: this.res.noise });
    const bp = new BiquadFilterNode(this.ctx, { type: 'bandpass', frequency: E.bandHz * (1 + strength), Q: E.q });
    const g = new GainNode(this.ctx, { gain: 0 });
    src.connect(bp).connect(g).connect(this.sum);
    const peak = E.gain * strength * AUDIO.userVolume.E;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.003);
    g.gain.setTargetAtTime(0, now + 0.003, dur / 4);
    src.start(now, Math.random() * (this.res.noise.duration - 0.5));
    src.stop(now + dur + 0.1);
    this.bOvershoot = E.pitchOvershoot * strength * Math.sign(direction);
    this.bOvershootTau = dur / 3;
  }

  /** Spool-down one-shot on disarm/unplug from speed (recording path only). */
  startSpoolDown(): void {
    if (!this.res.spoolDown || this.lastRpm < AUDIO.spool.downMinRpm) return;
    this.startSpool('down', this.res.spoolDown);
  }

  /** Spool-up one-shot when arming from rest (recording path only). */
  startSpoolUp(): void {
    if (!this.res.spoolUp || this.lastRpm > 50) return;
    this.startSpool('up', this.res.spoolUp);
  }

  private startSpool(kind: 'up' | 'down', buffer: AudioBuffer): void {
    this.stopSpool();
    const now = this.ctx.currentTime;
    const gain = new GainNode(this.ctx, { gain: 0 });
    const src = new AudioBufferSourceNode(this.ctx, { buffer });
    src.connect(gain).connect(this.sum);
    src.start(now);
    this.spool = { kind, src, gain, pos: 0, age: 0, fading: false };
    this.set(this.aDuck.gain, 0, now);
  }

  private stopSpool(): void {
    if (!this.spool) return;
    const now = this.ctx.currentTime;
    const s = this.spool;
    s.gain.gain.setTargetAtTime(0, now, AUDIO.spool.crossfadeS / 3);
    s.src.stop(now + AUDIO.spool.crossfadeS * 2);
    this.set(this.aDuck.gain, 1, now);
    this.spool = null;
  }

  /**
   * @param rpm this motor's RPM
   * @param rpmRate its rate of change (RPM/s)
   * @param driven whether the ESC is driving it (transients only while driven)
   */
  update(dt: number, rpm: number, rpmRate: number, driven: boolean): void {
    const now = this.ctx.currentTime;
    const p = voiceParams(rpm, !!this.res.loop);
    const vol = AUDIO.userVolume;

    this.sinceTransient += dt;
    const strength = driven ? transientStrength(rpmRate) : 0;
    if (strength > 0 && this.sinceTransient >= AUDIO.layers.E.refractoryS) {
      this.sinceTransient = 0;
      this.transient(strength, rpmRate, now);
    }
    this.bOvershoot *= Math.exp(-dt / this.bOvershootTau);

    if (this.aSrc) this.set(this.aSrc.playbackRate, p.aRate, now);
    this.set(this.aGain.gain, p.aGain * vol.A, now);
    this.set(this.bOsc.frequency, Math.max(1, p.bHz * (1 + this.bOvershoot)), now);
    this.set(this.bGain.gain, p.bGain * vol.B, now);
    this.set(this.cOsc.frequency, Math.max(1, p.cHz), now);
    this.set(this.cOsc2.frequency, Math.max(2, p.cHz * 2), now);
    this.set(this.cGain.gain, p.cGain * vol.C, now);
    this.set(this.dFilter.frequency, p.dHz, now);
    this.set(this.dGain.gain, p.dGain * vol.D, now);

    // Spool one-shot: keep the clip's pitch on the motor's pitch as both move.
    const s = this.spool;
    if (s) {
      const S = AUDIO.spool;
      s.age += dt;
      const [p0, p1] = s.kind === 'up' ? S.upPitchHz : S.downPitchHz;
      const dur = s.kind === 'up' ? S.upDurationS : S.downDurationS;
      const clipPitch = lerp(p0, p1, s.pos / dur);
      const rate = Math.min(3, Math.max(0.25, fundamentalHz(rpm) / clipPitch));
      this.set(s.src.playbackRate, rate, now);
      s.pos += rate * dt;
      const level = S.gain * (Math.max(rpm, 1) / MOTOR.rpmHover) ** 1.2 * vol.A;
      this.set(s.gain.gain, level, now);
      const handOff = s.kind === 'up' ? s.age >= S.upHoldS : s.pos >= dur || rpm < MOTOR.stopRpm;
      if (handOff || (s.kind === 'down' && driven)) this.stopSpool();
    }
    this.lastRpm = rpm;
  }

  dispose(): void {
    this.stopSpool();
    for (const n of [this.aSrc, this.bOsc, this.cOsc, this.cOsc2, this.dSrc]) n?.stop();
    this.panner.disconnect();
  }
}
