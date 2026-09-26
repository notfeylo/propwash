import type { App } from './App';
import type { CameraMode, FeedStyle, HdStabilization } from '../config/cameras';
import { toCsv } from '../sim/blackbox';
import { attitude } from '../sim/frames';
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
  hdStabilization: HdStabilization;
  /** Render camera roll against the horizon (deg): 0 = level (HD horizon lock). */
  rollDeg: number;
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
  /** Motor test panel (PRD §4.8): open/close, safety, and a slider (index −1 = master). */
  motorTest(open: boolean, safety?: boolean): void;
  setMotorSlider(index: number, value: number): void;
  openSettings(open: boolean): void;
  /** Flight physics state (null until Rapier has loaded, or on the bench). */
  flight(): {
    airframe: string;
    wind: string;
    position: [number, number, number];
    velocity: [number, number, number];
    tiltDeg: number;
    rpm: number[];
    voltage: number;
    current: number;
    droppedSteps: number;
    onGround: boolean;
    propStrike: boolean[];
    turtle: boolean;
    /** True attitude (deg): roll right, pitch nose-down, heading clockwise from −Z. */
    attitude: [number, number, number];
  } | null;
  /** The test field: gate centres (world, m) with the direction you fly through them, and ground height. */
  gates(): { center: [number, number, number]; yaw: number }[];
  groundAt(x: number, z: number): number;
  setWind(preset: 'calm' | 'light' | 'breezy'): void;
  resetDrone(): void;
  /** Orbit camera follows the drone in flight (default on). */
  setFollow(follow: boolean): void;
  /** Fixed roll/pitch/yaw sticks (−1..1), null = the input devices. */
  setSticks(sticks: { roll: number; pitch: number; yaw: number } | null): void;
  setFlightMode(mode: 'acro' | 'angle' | 'horizon'): void;
  /** Put the drone at (x, z), `altitude` above the ground, rolled `rollDeg` (180 = upside down). */
  placeDrone(x: number, z: number, altitude?: number, rollDeg?: number): void;
  /** Turtle mode switch. */
  setTurtle(on: boolean): void;
  /** Land mode (armed): returns whether it is on. */
  toggleLand(): boolean;
  setHdStabilization(m: HdStabilization): void;
  /** Physics + FC time per frame (ms) over the last 600 frames, and field colliders in the world. */
  perf(): {
    median: number;
    p95: number;
    max: number;
    frames: number;
    liveColliders: number;
    simTime: number;
    totalMs: number;
  };
  /** Where the drone model is drawn (the live drone, or the replay's). */
  dronePosition(): Vec3;
  /** Flight recording (Phase 2 §8.2): the one in progress, else the last. */
  recording(): { active: boolean; seconds: number; samples: number; ops: number; seed: number } | null;
  /** The recording as blackbox_decode-style CSV text. */
  blackboxCsv(): string | null;
  startReplay(): void;
  stopReplay(): void;
  seekReplay(t: number): void;
  /** Replay state; `mismatch` −1 while bit-identical to the recording. */
  replay(): { t: number; duration: number; ready: number; playing: boolean; mismatch: number } | null;
  openFlightLab(open: boolean): Promise<void>;
  /** Last flight-controller loop: setpoint and gyro (deg/s), PID terms, motor commands. */
  fc(): unknown;
  settings(): unknown;
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
    motorTest(open, safety) {
      app.toggleMotorPanel(open);
      if (safety !== undefined) app.motorPanel.setSafety(safety);
    },
    setMotorSlider: (i, v) => app.motorPanel.set(i, v),
    openSettings: (open) => app.toggleSettings(open),
    flight() {
      const f = app.flight;
      if (!f) return null;
      const s = f.state;
      const q = s.quaternion;
      return {
        airframe: f.airframe.id,
        wind: f.wind.preset,
        position: [s.position.x, s.position.y, s.position.z],
        velocity: [s.velocity.x, s.velocity.y, s.velocity.z],
        tiltDeg: (Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))) * 180) / Math.PI,
        rpm: [...s.rpm],
        voltage: s.voltage,
        current: s.current,
        droppedSteps: f.droppedSteps,
        onGround: s.onGround,
        propStrike: [...s.propStrike],
        turtle: app.powertrain.turtleActive,
        attitude: (() => {
          const a = attitude(q);
          return [a.roll / DEG, a.pitch / DEG, a.yaw / DEG] as [number, number, number];
        })(),
      };
    },
    gates: () => app.field?.layout.gates.map((g) => ({ center: [...g.center], yaw: g.yaw })) ?? [],
    groundAt: (x, z) => app.flight?.groundAt(x, z) ?? 0,
    setWind: (w) => app.flight && (app.flight.wind.preset = w),
    resetDrone: () => app.resetDrone(),
    setFollow: (f) => (app.followDrone = f),
    setSticks: (s) => (app.sticksOverride = s ? { ...s } : null),
    setFlightMode(mode) {
      app.settings.flightMode = mode;
      app.applyFcSettings();
    },
    setHdStabilization: (m) => (app.cameras.hdStabilization = m),
    perf() {
      const a = [...app.physicsMs].filter((v) => v > 0).sort((x, y) => x - y);
      const q = (p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))] ?? 0;
      return {
        median: q(0.5),
        p95: q(0.95),
        max: a.at(-1) ?? 0,
        frames: a.length,
        liveColliders: app.flight?.liveFieldColliders ?? 0,
        simTime: app.flight?.state.time ?? 0,
        totalMs: app.physicsTotalMs,
      };
    },
    dronePosition: () => {
      const p = app.drone.root.position;
      return [p.x, p.y, p.z];
    },
    recording() {
      const r = app.recorder?.current;
      if (!r) return null;
      return {
        active: app.recorder?.active === r,
        seconds: r.blackbox.duration,
        samples: r.blackbox.length,
        ops: r.ops.length,
        seed: r.seed,
      };
    },
    blackboxCsv: () => (app.recorder?.current ? toCsv(app.recorder.current.blackbox) : null),
    startReplay: () => app.startReplay(),
    stopReplay: () => app.stopReplay(),
    seekReplay: (t) => app.seekReplay(t),
    replay() {
      const r = app.replay;
      if (!r) return null;
      return { t: r.t, duration: r.run.duration, ready: r.run.ready, playing: r.playing, mismatch: r.run.mismatch };
    },
    openFlightLab: (open) => app.toggleFlightLab(open),
    fc: () => (app.flight ? JSON.parse(JSON.stringify(app.flight.fc.telemetry)) : null),
    placeDrone(x, z, altitude = 0, rollDeg = 0) {
      const f = app.flight;
      if (!f) return;
      const p = f.restingAt(x, z);
      f.reset({ x: p.x, y: p.y + altitude, z: p.z });
      const r = (rollDeg * Math.PI) / 360;
      const q = { x: 0, y: 0, z: Math.sin(r), w: Math.cos(r) };
      f.body.setRotation(q, true);
      // A teleport isn't something the sensors saw: restart the FC's estimate and integrators.
      f.fc.reset(q, f.inputs.sticks);
    },
    setTurtle: (on) => (app.powertrain.turtleSwitch = on),
    toggleLand: () => app.powertrain.toggleAutoland(),
    settings: () => JSON.parse(JSON.stringify(app.settings)),
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
        hdStabilization: c.hdStabilization,
        rollDeg: (() => {
          // Angle between the camera's right vector and the horizontal plane.
          const right = r.position.clone().set(1, 0, 0).applyQuaternion(r.quaternion);
          return (Math.asin(Math.max(-1, Math.min(1, right.y))) * 180) / Math.PI;
        })(),
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
