import { AUDIO, type AudioLayer } from '../config/audio';
import { LEDS } from '../config/drone';
import { BATTERY } from '../config/motor';
import { RENDER } from '../config/render';
import { mulberry32 } from '../sim/MotorModel';
import type { PowerEvent, PowerState } from '../sim/PowerStateMachine';
import { Powertrain } from '../sim/Powertrain';
import { AudioEngine, type AudioFrame, type CameraAudioMode, type Vec3 } from './AudioEngine';

export type ScenarioAction =
  | 'plug'
  | 'unplug'
  | 'arm'
  | 'disarm'
  | 'kill'
  | 'beacon'
  | { throttle: number }
  | { ramp: { to: number; overS: number } };

export interface OfflineScenario {
  durationS: number;
  steps: { at: number; do: ScenarioAction }[];
  /** Use the recording-derived clips if the server has them. */
  clips?: boolean;
  /** Per-layer volume overrides (e.g. { E: 0 } to render without transients). */
  volume?: Partial<Record<AudioLayer, number>>;
  listener?: { position: Vec3; target?: Vec3 };
  cameraMode?: CameraAudioMode;
  sampleRate?: number;
  seed?: number;
  /** Start with a partly used pack (0..1), e.g. to hear the low-battery beeper. */
  batterySoc?: number;
}

export interface OfflineFrame {
  t: number;
  state: PowerState;
  throttle: number;
  rpms: number[];
  events: PowerEvent['type'][];
  warning: string | null;
}

export interface OfflineResult {
  sampleRate: number;
  mode: 'recording' | 'procedural';
  left: Float32Array;
  right: Float32Array;
  frames: OfflineFrame[];
}

const PAD_TOP = 0.004;

/** Rotor centres and FC emitter as placed on the bench (payload on). */
function benchPositions() {
  const lift = PAD_TOP + 0.0118;
  const y = 0.07 + lift;
  const [x, z] = [0.1217, 0.1233];
  const rotors: Vec3[] = [
    [x, y, z],
    [x, y, -z],
    [-x, y, z],
    [-x, y, -z],
  ];
  const fc = LEDS.fc.position;
  return { rotors, frame: [fc[0], fc[1] + lift, fc[2]] as Vec3, center: [0, y - 0.02, 0] as Vec3 };
}

/**
 * Render a scripted bench session through the real Powertrain + AudioEngine in an
 * OfflineAudioContext. The sim steps every 3 render quanta (≈8.7 ms at 44.1 kHz).
 */
export async function renderOffline(s: OfflineScenario): Promise<OfflineResult> {
  const sr = s.sampleRate ?? 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(s.durationS * sr), sr);
  const rand = mulberry32(s.seed ?? 11);
  const saved = { ...AUDIO.userVolume };
  Object.assign(AUDIO.userVolume, s.volume ?? {});

  try {
    const engine = await AudioEngine.create(ctx, { loadClips: s.clips ?? false, rand });
    const pt = new Powertrain(s.seed ?? 11, rand);
    if (s.batterySoc !== undefined) pt.battery.usedMah = (1 - s.batterySoc) * BATTERY.capacityMah;
    const pos = benchPositions();
    const lp = s.listener?.position ?? RENDER.camera.position;
    const target = s.listener?.target ?? pos.center;
    const fwd = [target[0] - lp[0], target[1] - lp[1], target[2] - lp[2]];
    const len = Math.hypot(...fwd);
    const forward = fwd.map((c) => c / len) as unknown as Vec3;

    const dt = (128 * 3) / sr;
    const frames: OfflineFrame[] = [];
    const pending = [...s.steps].sort((a, b) => a.at - b.at);
    let ramp: { from: number; to: number; t0: number; overS: number } | null = null;

    const tick = (t: number) => {
      while (pending.length && pending[0].at <= t + 1e-9) {
        const a = pending.shift()!.do;
        if (a === 'plug') pt.power.plug();
        else if (a === 'unplug') pt.power.unplug();
        else if (a === 'arm') pt.arm();
        else if (a === 'disarm') pt.disarm();
        else if (a === 'kill') pt.kill();
        else if (a === 'beacon') pt.toggleBeacon();
        else if ('throttle' in a) {
          ramp = null;
          pt.throttle = a.throttle;
        } else ramp = { from: pt.throttle, to: a.ramp.to, t0: t, overS: a.ramp.overS };
      }
      if (ramp) {
        const k = Math.min(1, (t - ramp.t0) / ramp.overS);
        pt.throttle = ramp.from + (ramp.to - ramp.from) * k;
        if (k >= 1) ramp = null;
      }
      const events = pt.update(t === 0 ? 0 : dt);
      const frame: AudioFrame = {
        dt,
        rpms: pt.rpms,
        rpmRates: pt.motors.motors.map((m) => m.rpmRate),
        driven: pt.driven,
        events,
        beacon: pt.power.beacon,
        lowBattery: pt.power.powered && pt.battery.lowWarning,
        rotorPositions: pos.rotors,
        framePosition: pos.frame,
        listener: { position: lp as unknown as Vec3, forward, up: [0, 1, 0] },
        cameraMode: s.cameraMode ?? 'orbit',
        distance: len,
      };
      engine.update(frame);
      frames.push({
        t,
        state: pt.power.state,
        throttle: pt.throttle,
        rpms: pt.rpms.map((r) => Math.round(r)),
        events: events.map((e) => e.type),
        warning: pt.power.warning,
      });
    };

    tick(0);
    const steps = Math.floor(s.durationS / dt) - 1;
    for (let k = 1; k <= steps; k++) {
      const t = k * dt;
      void ctx.suspend(t).then(() => {
        tick(t);
        void ctx.resume();
      });
    }
    const buf = await ctx.startRendering();
    return {
      sampleRate: sr,
      mode: engine.mode,
      left: buf.getChannelData(0),
      right: buf.getChannelData(1),
      frames,
    };
  } finally {
    Object.assign(AUDIO.userVolume, saved);
  }
}

/** Int16 PCM as base64, for handing renders to Node without huge JSON arrays. */
export function toPcm16Base64(x: Float32Array): string {
  const i16 = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) i16[i] = Math.max(-1, Math.min(1, x[i])) * 32767;
  const bytes = new Uint8Array(i16.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
