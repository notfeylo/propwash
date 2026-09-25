import { AUDIO, type AudioLayer } from '../config/audio';
import { CAMERAS, type FeedStyle } from '../config/cameras';
import { GAMEPAD, HAPTICS, KEYBOARD, type ThrottleSource } from '../config/input';
import { ARMING } from '../config/motor';
import type { QualityPreset } from '../config/render';

export type KeyAction = keyof typeof KEYBOARD.keys;

/** Everything the Settings panel changes (PRD §4.8), persisted per browser. */
export interface Settings {
  quality: QualityPreset | 'auto';
  uptiltDeg: number;
  fpvFovDeg: number;
  feed: FeedStyle;
  whipPan: boolean;
  jello: boolean;
  volume: number;
  layers: Record<AudioLayer, number>;
  payload: boolean;
  softArm: boolean;
  throttleSource: ThrottleSource;
  throttleHold: boolean;
  deadzone: number;
  expo: number;
  rumble: boolean;
  showFps: boolean;
  keys: Record<KeyAction, string[]>;
}

export const SETTINGS_KEY = 'propwash.settings.v1';
export const FOV_RANGE_DEG = [100, 150] as const;

/** Defaults come straight from config, so config stays the single source of tuning. */
export function defaultSettings(): Settings {
  return {
    quality: 'auto',
    uptiltDeg: CAMERAS.fpv.uptiltDeg,
    fpvFovDeg: CAMERAS.fpv.hfovDeg,
    feed: CAMERAS.fpv.defaultFeed,
    whipPan: CAMERAS.cut.whipPan,
    jello: CAMERAS.hd.jello.enabled,
    volume: 0.8,
    layers: { ...AUDIO.userVolume },
    payload: true,
    softArm: ARMING.softArm,
    throttleSource: GAMEPAD.throttleSource,
    throttleHold: GAMEPAD.throttleHold,
    deadzone: GAMEPAD.deadzone,
    expo: GAMEPAD.expo,
    rumble: HAPTICS.enabled,
    showFps: false,
    keys: Object.fromEntries(Object.entries(KEYBOARD.keys).map(([k, v]) => [k, [...v]])) as Record<KeyAction, string[]>,
  };
}

const DEFAULTS = defaultSettings();

/** Merge stored values over defaults, keeping only known keys of the right type. */
export function mergeSettings(raw: unknown): Settings {
  const out = defaultSettings();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(out) as (keyof Settings)[]) {
    const v = r[k];
    if (v === undefined) continue;
    if (k === 'layers' || k === 'keys') {
      if (v && typeof v === 'object') {
        const target = out[k] as Record<string, unknown>;
        for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
          if (!(sk in target)) continue;
          if (k === 'layers' && typeof sv === 'number' && Number.isFinite(sv))
            target[sk] = Math.max(0, Math.min(2, sv));
          if (k === 'keys' && Array.isArray(sv) && sv.every((c) => typeof c === 'string')) target[sk] = sv;
        }
      }
    } else if (typeof v === typeof DEFAULTS[k]) {
      (out as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

export function loadSettings(): Settings {
  try {
    return mergeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked (private mode, policy): settings last for this session.
  }
}

/** Push the config-level settings into the live config objects the sim, audio and input read. */
export function applyConfigSettings(s: Settings): void {
  Object.assign(AUDIO.userVolume, s.layers);
  ARMING.softArm = s.softArm;
  CAMERAS.fpv.hfovDeg = s.fpvFovDeg;
  CAMERAS.cut.whipPan = s.whipPan;
  GAMEPAD.deadzone = s.deadzone;
  GAMEPAD.expo = s.expo;
  HAPTICS.enabled = s.rumble;
  for (const [k, v] of Object.entries(s.keys)) KEYBOARD.keys[k as KeyAction] = [...v];
}
