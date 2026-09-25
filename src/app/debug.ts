import type { App } from './App';
import type { CameraMode, FeedStyle } from '../config/cameras';
import type { ControlState } from '../input/types';
import type { BackgroundMode, QualityPreset } from '../config/render';
import type { FcLedMode, VtxLedMode } from '../drone/LEDs';
import type { PropWeights } from '../drone/propBlend';
import type { OfflineScenario } from '../audio/offline';
import type { PowerState } from '../sim/PowerStateMachine';

type Vec3 = [number, number, number];

export interface RotorInfo {
  name: string;
  motor: number;
  spin: 'CW' | 'CCW';
  angleDeg: number;
  rpm: number;
  weights: PropWeights;
  /** Pivot position in world space (m). */
  pivotWorld: Vec3;
  /** Hub-vertex centroid in world space (m); must not move as the rotor turns. */
  hubCentroidWorld: Vec3;
  /** One blade's tip vertex in world space (m). */
  bladeTipWorld: Vec3;
}

export interface PowerInfo {
  state: PowerState;
  warning: string | null;
  beacon: boolean;
  throttle: number;
  rpms: number[];
  battery: { voltage: number; cellVoltage: number; current: number; usedMah: number; soc: number; low: boolean };
  audio: { state: string; mode: string };
}

export interface RenderedAudio {
  sampleRate: number;
  mode: string;
  /** Int16 PCM, base64. */
  left: string;
  right: string;
  frames: { t: number; state: string; throttle: number; rpms: number[]; events: string[]; warning: string | null }[];
}

export interface CameraInfo {
  mode: CameraMode;
  feed: FeedStyle;
  uptiltDeg: number;
  cutting: boolean;
  /** Video area in CSS px. */
  box: { x: number; y: number; width: number; height: number };
  /** Render camera: world position, vertical FOV (deg), aspect. */
  position: Vec3;
  fovDeg: number;
  aspect: number;
  /** OSD text currently drawn (one element per entry). */
  osd: string[];
}

export interface DebugHandle {
  ready: boolean;
  backend: 'webgpu' | 'webgl2';
  readonly preset: QualityPreset;
  readonly scale: number;
  setQuality(preset: QualityPreset): void;
  setBackground(mode: BackgroundMode): void;
  /** Place the orbit camera; target defaults to the current orbit target. */
  setView(position: Vec3, target?: Vec3, fovDeg?: number): void;
  /** Force prop RPM (bypasses the motor model); clearRpm() hands control back. */
  setRpm(rpm: number | number[]): void;
  clearRpm(): void;
  /** Power / arming (same paths as the keyboard). */
  plug(): void;
  arm(): boolean;
  disarm(): void;
  kill(): void;
  toggleBeacon(): void;
  /** Force throttle 0..1 (null = keyboard). */
  setThrottle(throttle: number | null): void;
  power(): PowerInfo;
  /** Render a scripted session offline through the real motor model + audio engine. */
  renderAudio(scenario: OfflineScenario): Promise<RenderedAudio>;
  /** Set every rotor (or each, M1..M4) to an absolute angle in degrees. */
  setRotorAngles(deg: number | number[]): void;
  /** Skip drawing but keep input, sim and audio running (for sim tests on software GL). */
  setRenderPaused(paused: boolean): void;
  /** Stop the simulation clock (rendering continues); step() advances it. */
  freeze(frozen: boolean): void;
  step(dtS: number): void;
  setSpinArrows(visible: boolean): void;
  setPayloadVisible(visible: boolean): void;
  setLeds(fc: FcLedMode, vtx: VtxLedMode, rearStrip: boolean): void;
  rotors(): RotorInfo[];
  groundOffset(): number;
  /** Camera views (PRD §4.6). `instant` skips the 150 ms cut. */
  setCamera(mode: CameraMode, instant?: boolean): void;
  setFeed(feed: FeedStyle): void;
  setUptilt(deg: number): void;
  setJello(enabled: boolean): void;
  setWhipPan(enabled: boolean): void;
  camera(): CameraInfo;
  /** Last frame's normalized input (PRD §4.7) and the connected pads. */
  input(): { state: ControlState | null; pads: { index: number; kind: string; name: string; calibrated: boolean }[] };
  openCalibration(): void;
  setUiHidden(hidden: boolean): void;
  /** World point → CSS pixel in the canvas, through the active view (before the barrel). */
  project(world: Vec3): [number, number];
}

declare global {
  interface Window {
    __propwash?: DebugHandle;
    /** Dev builds only: the live App, for poking at state from the console. */
    __app?: App;
  }
}

const DEG = Math.PI / 180;

/** Handle used by the Playwright smoke test and the verification screenshots. */
export function exposeDebug(app: App): void {
  if (import.meta.env.DEV) window.__app = app;
  const drone = app.drone;
  const each = <T>(v: T | T[], i: number) => (Array.isArray(v) ? v[i] : v);
  window.__propwash = {
    ready: true,
    backend: app.backend,
    get preset() {
      return app.quality.preset;
    },
    get scale() {
      return app.quality.scale;
    },
    setQuality: (p) => app.applyPreset(p),
    setBackground: (m) => app.environment.setBackground(m),
    setView(position, target, fovDeg) {
      if (target) app.controls.target.set(...target);
      app.camera.position.set(...position);
      if (fovDeg) {
        app.camera.fov = fovDeg;
        app.camera.updateProjectionMatrix();
      }
      app.controls.update();
    },
    setRpm: (rpm) => (app.rpmOverride = typeof rpm === 'number' ? [rpm, rpm, rpm, rpm] : [...rpm]),
    clearRpm: () => (app.rpmOverride = null),
    plug: () => app.powertrain.togglePlug(),
    arm: () => app.powertrain.arm(),
    disarm: () => app.powertrain.disarm(),
    kill: () => app.powertrain.kill(),
    toggleBeacon: () => app.powertrain.toggleBeacon(),
    setThrottle: (t) => (app.throttleOverride = t),
    power() {
      const pt = app.powertrain;
      const b = pt.battery;
      return {
        state: pt.power.state,
        warning: pt.power.warning,
        beacon: pt.power.beacon,
        throttle: pt.throttle,
        rpms: pt.rpms,
        battery: {
          voltage: b.voltage,
          cellVoltage: b.cellVoltage,
          current: b.current,
          usedMah: b.usedMah,
          soc: b.soc,
          low: b.lowWarning,
        },
        audio: { state: app.audio.state, mode: app.audio.mode },
      };
    },
    async renderAudio(scenario) {
      const { renderOffline, toPcm16Base64 } = await import('../audio/offline');
      // Offline rendering steps the sim from suspend() callbacks on the main thread; a
      // software-rendered frame loop would delay each one, so pause the view meanwhile.
      app.stop();
      let r;
      try {
        r = await renderOffline(scenario);
      } finally {
        if (!document.hidden) app.start();
      }
      return {
        sampleRate: r.sampleRate,
        mode: r.mode,
        left: toPcm16Base64(r.left),
        right: toPcm16Base64(r.right),
        frames: r.frames,
      };
    },
    setRotorAngles: (deg) => drone.rotors.forEach((r, i) => r.setAngle(each(deg, i) * DEG)),
    freeze: (f) => (app.simFrozen = f),
    setRenderPaused: (p) => (app.renderPaused = p),
    step: (dt) => app.step(dt),
    setSpinArrows: (v) => drone.setSpinArrowsVisible(v),
    setPayloadVisible: (v) => drone.setPayloadVisible(v),
    setLeds(fc, vtx, rear) {
      drone.leds.setFc(fc);
      drone.leds.setVtx(vtx);
      drone.leds.setRearStrip(rear);
    },
    rotors: () =>
      drone.rotors.map((r) => {
        r.pivot.updateWorldMatrix(true, false);
        const p = r.pivot.getWorldPosition(r.pivot.position.clone().set(0, 0, 0));
        const c = r.hubCentroid.clone().applyMatrix4(r.pivot.matrixWorld);
        const t = r.bladeTip.clone().applyMatrix4(r.pivot.matrixWorld);
        return {
          name: r.name,
          motor: r.motorIndex,
          spin: r.spin,
          angleDeg: r.angle / DEG,
          rpm: r.rpm,
          weights: r.weights,
          pivotWorld: [p.x, p.y, p.z],
          hubCentroidWorld: [c.x, c.y, c.z],
          bladeTipWorld: [t.x, t.y, t.z],
        };
      }),
    groundOffset: () => drone.groundOffset,
    input: () => ({
      state: app.controlState,
      pads: [...app.input.pads].map(([index, p]) => ({
        index,
        kind: 'calibration' in p ? 'radio' : 'gamepad',
        name: p.name,
        calibrated: 'calibration' in p ? !!p.calibration : true,
      })),
    }),
    openCalibration: () => app.calibrateRadio(),
    setUiHidden: (h) => app.setUiHidden(h),
    setCamera: (mode, instant) => app.cameras.setMode(mode, instant),
    setFeed: (feed) => app.cameras.setFeed(feed),
    setUptilt: (deg) => app.cameras.setUptilt(deg),
    setJello: (on) => (app.cameras.jello = on),
    setWhipPan: (on) => (app.cameras.whipPan = on),
    camera() {
      const c = app.cameras;
      const r = c.renderCamera;
      return {
        mode: c.mode,
        feed: c.feed,
        uptiltDeg: c.uptiltDeg,
        cutting: c.cutting,
        box: c.videoBox,
        position: [r.position.x, r.position.y, r.position.z],
        fovDeg: r.fov,
        aspect: r.aspect,
        osd: [...app.osd.lines],
      };
    },
    project(world) {
      const cam = app.cameras.renderCamera;
      const v = cam.position
        .clone()
        .set(...world)
        .project(cam);
      const b = app.cameras.videoBox;
      return [b.x + ((v.x + 1) / 2) * b.width, b.y + ((1 - v.y) / 2) * b.height];
    },
  };
}
