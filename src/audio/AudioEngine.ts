import { AUDIO } from '../config/audio';
import { DRONE } from '../config/drone';
import type { PowerEvent } from '../sim/PowerStateMachine';
import { Beeper } from './Beeper';
import { loadClip, loopBufferFrom, noiseBuffer, roomImpulse } from './buffers';
import { MotorVoice, type VoiceResources } from './MotorVoice';

export type Vec3 = readonly [number, number, number];
export type CameraAudioMode = 'orbit' | 'fpv';

export interface AudioFrame {
  dt: number;
  rpms: readonly number[];
  rpmRates: readonly number[];
  /** ESCs are driving the motors (armed). */
  driven: boolean;
  events: readonly PowerEvent[];
  beacon: boolean;
  lowBattery: boolean;
  /** Rotor centres (m, world). */
  rotorPositions: readonly Vec3[];
  /** FC / battery-lead emitter for the buzzer and the plug tick (m, world). */
  framePosition: Vec3;
  listener: { position: Vec3; forward: Vec3; up: Vec3 };
  cameraMode: CameraAudioMode;
  /** Listener → drone distance, for air absorption (m). */
  distance: number;
  // Flight coupling (Phase 2 §6); absent on the bench.
  /** Airspeed (m/s): layer F wind rush. */
  airspeed?: number;
  /** Prop wash severity 0..1 (chop on A and D). */
  propWash?: number;
  /** Doppler pitch factor for the outside views (1 = none). */
  doppler?: number;
  /** Impacts this frame: contact acceleration (g) and what was hit. */
  impacts?: readonly { g: number; surface: 'grass' | 'hard' }[];
  /** Motors whose prop struck something this frame (M1..M4 indices). */
  propStrikes?: readonly number[];
}

export interface AudioEngineOptions {
  /** Try to load the recording-derived clips (absent in public builds). */
  loadClips?: boolean;
  rand?: () => number;
}

const dbToGain = (db: number) => 10 ** (db / 20);

/**
 * Motor sound for the bench (PRD §4.5): four spatialized motor voices, ESC/FC beeps, a
 * gentle master compressor, an optional procedural small room, and camera-dependent colour.
 * Works on a live AudioContext or an OfflineAudioContext (verification renders).
 */
export class AudioEngine {
  readonly voices: MotorVoice[];
  readonly beeper: Beeper;
  readonly mode: 'recording' | 'procedural';
  private bus: GainNode;
  private shelf: BiquadFilterNode;
  private air: BiquadFilterNode;
  private roomWet: GainNode;
  private master: GainNode;
  private frameEmitter: PannerNode;
  private windGain: GainNode;
  /** F: wind / air rush. */
  private airGain: GainNode;
  private airFilter: BiquadFilterNode;
  private lastImpact = -Infinity;
  private noise: AudioBuffer;
  private nextBeacon = 0;
  private nextLowBattery = 0;

  static async create(ctx: BaseAudioContext, opts: AudioEngineOptions = {}): Promise<AudioEngine> {
    const [loopClip, spoolUp, spoolDown] = opts.loadClips
      ? await Promise.all([
          loadClip(ctx, AUDIO.clips.loop),
          loadClip(ctx, AUDIO.clips.spoolUp),
          loadClip(ctx, AUDIO.clips.spoolDown),
        ])
      : [null, null, null];
    const res: VoiceResources = {
      noise: noiseBuffer(ctx),
      loop: loopClip ? loopBufferFrom(ctx, loopClip) : null,
      spoolUp,
      spoolDown,
    };
    return new AudioEngine(ctx, res, opts.rand ?? Math.random);
  }

  private constructor(
    readonly ctx: BaseAudioContext,
    res: VoiceResources,
    rand: () => number,
  ) {
    const c = ctx;
    this.noise = res.noise;
    this.mode = res.loop ? 'recording' : 'procedural';
    const comp = AUDIO.master.compressor;
    const compressor = new DynamicsCompressorNode(c, {
      threshold: comp.threshold,
      knee: comp.knee,
      ratio: comp.ratio,
      attack: comp.attack,
      release: comp.release,
    });
    this.master = new GainNode(c, { gain: AUDIO.master.gain });
    compressor.connect(this.master).connect(c.destination);

    this.bus = new GainNode(c, { gain: 1 });
    this.shelf = new BiquadFilterNode(c, { type: 'highshelf', frequency: AUDIO.fpv.highShelfHz, gain: 0 });
    this.air = new BiquadFilterNode(c, { type: 'lowpass', frequency: 20000, Q: 0.5 });
    this.bus.connect(this.shelf).connect(this.air).connect(compressor);

    this.roomWet = new GainNode(c, { gain: AUDIO.room.enabled ? AUDIO.room.wet : 0 });
    const room = new ConvolverNode(c, { buffer: roomImpulse(c) });
    this.air.connect(room).connect(this.roomWet).connect(compressor);

    // FPV prop-wash rumble at the camera.
    const wind = new AudioBufferSourceNode(c, { buffer: res.noise, loop: true });
    const windLp = new BiquadFilterNode(c, { type: 'lowpass', frequency: AUDIO.fpv.windLowpassHz, Q: 0.7 });
    this.windGain = new GainNode(c, { gain: 0 });
    wind.connect(windLp).connect(this.windGain).connect(compressor);
    wind.start(0, 0.5);

    // F: air rush over the airframe, band-passed noise rising with airspeed.
    const air = new AudioBufferSourceNode(c, { buffer: res.noise, loop: true });
    this.airFilter = new BiquadFilterNode(c, { type: 'bandpass', frequency: AUDIO.wind.centerHz[0], Q: AUDIO.wind.q });
    this.airGain = new GainNode(c, { gain: 0 });
    air.connect(this.airFilter).connect(this.airGain).connect(compressor);
    air.start(0, 1.3);

    this.voices = Array.from({ length: 4 }, () => new MotorVoice(c, this.bus, res, rand));
    this.frameEmitter = new PannerNode(c, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: AUDIO.panner.refDistance,
      maxDistance: AUDIO.panner.maxDistance,
    });
    this.frameEmitter.connect(this.bus);
    this.beeper = new Beeper(c, this.voices, this.frameEmitter, res.noise);
  }

  private set(param: AudioParam, value: number): void {
    param.setTargetAtTime(value, this.ctx.currentTime, AUDIO.paramSmoothingS);
  }

  private setListener(l: AudioFrame['listener']): void {
    const L = this.ctx.listener;
    if (L.positionX) {
      this.set(L.positionX, l.position[0]);
      this.set(L.positionY, l.position[1]);
      this.set(L.positionZ, l.position[2]);
      this.set(L.forwardX, l.forward[0]);
      this.set(L.forwardY, l.forward[1]);
      this.set(L.forwardZ, l.forward[2]);
      this.set(L.upX, l.up[0]);
      this.set(L.upY, l.up[1]);
      this.set(L.upZ, l.up[2]);
    } else {
      const legacy = L as unknown as {
        setPosition(...p: number[]): void;
        setOrientation(...p: number[]): void;
      };
      legacy.setPosition(...l.position);
      legacy.setOrientation(...l.forward, ...l.up);
    }
  }

  private handle(e: PowerEvent, now: number): void {
    const B = AUDIO.beeps;
    const bz = B.buzzer;
    switch (e.type) {
      case 'plugged':
        this.beeper.plugIn(now);
        break;
      case 'escPowerOnTones':
        this.beeper.escSequence(B.powerOn.notesHz, B.powerOn.noteS, now);
        break;
      case 'escSignalTones':
        this.beeper.escSequence(B.signal.notesHz, B.signal.noteS, now);
        break;
      case 'armed':
        if (bz.armChirp.enabled) this.beeper.buzz(bz.freqHz, now, bz.armChirp.durationS);
        for (const v of this.voices) v.startSpoolUp();
        break;
      case 'disarmed':
        this.beeper.buzzPattern(bz.disarm.count, bz.disarm.durationS, bz.disarm.gapS, now);
        for (const v of this.voices) v.startSpoolDown();
        break;
      case 'unplugged':
        for (const v of this.voices) v.startSpoolDown();
        break;
      case 'armRefused':
        // An unpowered flight controller can't beep.
        if (e.reason !== 'NO POWER') this.beeper.buzz(bz.refused.freqHz, now, bz.refused.durationS);
        break;
      case 'beacon':
        this.nextBeacon = now;
        break;
      case 'ready':
        break;
    }
  }

  update(f: AudioFrame): void {
    const now = this.ctx.currentTime;
    for (const e of f.events) this.handle(e, now);

    if (f.beacon && now >= this.nextBeacon) {
      const b = AUDIO.beeps.beacon;
      this.beeper.escTone(b.freqHz, now, b.durationS);
      this.nextBeacon = now + b.periodS;
    }
    if (f.lowBattery && now >= this.nextLowBattery) {
      const lb = AUDIO.beeps.buzzer.lowBattery;
      this.beeper.buzzPattern(lb.count, lb.durationS, lb.gapS, now);
      this.nextLowBattery = now + lb.periodS;
    }

    const outside = f.cameraMode !== 'fpv';
    const dop = outside ? (f.doppler ?? 1) : 1;
    this.voices.forEach((v, i) => {
      const p = f.rotorPositions[i];
      if (p) v.setPosition(p[0], p[1], p[2]);
      v.update(f.dt, f.rpms[i] ?? 0, f.rpmRates[i] ?? 0, f.driven, { chop: f.propWash ?? 0, doppler: dop });
    });

    // F: air rush. On board (FPV) it's right at the mic; outside it falls off with distance.
    const W = AUDIO.wind;
    const as = f.airspeed ?? 0;
    const level =
      Math.min(W.maxGain, W.gain * (as / W.refMs) ** 2) *
      (outside ? 1 / (1 + f.distance / W.orbitFalloffM) : W.fpvBoost);
    this.set(this.airGain.gain, level);
    this.set(this.airFilter.frequency, W.centerHz[0] + (W.centerHz[1] - W.centerHz[0]) * Math.min(1, as / W.refMs));

    for (const hit of f.impacts ?? []) this.impact(hit.g, hit.surface, now);
    for (const i of f.propStrikes ?? []) this.voices[i]?.propStrike(f.rpms[i] ?? 0);
    const fp = f.framePosition;
    if (this.frameEmitter.positionX) {
      this.frameEmitter.positionX.value = fp[0];
      this.frameEmitter.positionY.value = fp[1];
      this.frameEmitter.positionZ.value = fp[2];
    }
    this.setListener(f.listener);

    // Camera colour: FPV = close bright mic + wash rumble; orbit = air absorption + small room.
    const fpv = f.cameraMode === 'fpv';
    const a = AUDIO.airAbsorption;
    const t = Math.min(1, Math.max(0, (f.distance - a.nearM) / (a.farM - a.nearM)));
    const airHz = fpv ? 20000 : a.nearHz * (a.farHz / a.nearHz) ** t;
    this.set(this.air.frequency, airHz);
    this.set(this.shelf.gain, fpv ? AUDIO.fpv.highShelfDb : 0);
    this.set(this.roomWet.gain, !fpv && AUDIO.room.enabled ? AUDIO.room.wet : 0);
    const load = f.rpms.reduce((s, r) => s + Math.min(1, r / DRONE.rpmMax) ** 2, 0) / (f.rpms.length || 1);
    this.set(this.windGain.gain, fpv ? AUDIO.fpv.windGain * load : 0);
  }

  /** A hit through the frame: grass thud or hard knock, plus a carbon crack; level ∝ log(g). */
  private impact(g: number, surface: 'grass' | 'hard', now: number): void {
    const I = AUDIO.impact;
    if (g < I.minG || now - this.lastImpact < I.refractoryS) return;
    this.lastImpact = now;
    const k = Math.min(1, Math.log(g / I.minG) / Math.log(I.fullG / I.minG));
    const burst = (filter: BiquadFilterNode, dur: number, gain: number) => {
      const src = new AudioBufferSourceNode(this.ctx, { buffer: this.noise });
      const env = new GainNode(this.ctx, { gain: 0 });
      src.connect(filter).connect(env).connect(this.frameEmitter);
      env.gain.setValueAtTime(gain, now);
      env.gain.setTargetAtTime(0, now + 0.004, dur / 3);
      src.start(now, Math.random() * 1.5);
      src.stop(now + dur * 2);
    };
    const body =
      surface === 'grass'
        ? new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: I.grass.lowpassHz })
        : new BiquadFilterNode(this.ctx, { type: 'bandpass', frequency: I.hard.bandHz, Q: I.hard.q });
    burst(
      body,
      surface === 'grass' ? I.grass.durationS : I.hard.durationS,
      I.gain * k * (surface === 'grass' ? 1.6 : 1),
    );
    burst(
      new BiquadFilterNode(this.ctx, { type: 'highpass', frequency: I.crack.highpassHz }),
      I.crack.durationS,
      I.gain * I.crack.gain * k,
    );
  }

  setMasterDb(db: number): void {
    this.set(this.master.gain, AUDIO.master.gain * dbToGain(db));
  }
}
