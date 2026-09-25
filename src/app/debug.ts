import type { App } from './App';
import type { BackgroundMode, QualityPreset } from '../config/render';
import type { FcLedMode, VtxLedMode } from '../drone/LEDs';
import type { PropWeights } from '../drone/propBlend';

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

export interface DebugHandle {
  ready: boolean;
  backend: 'webgpu' | 'webgl2';
  readonly preset: QualityPreset;
  readonly scale: number;
  setQuality(preset: QualityPreset): void;
  setBackground(mode: BackgroundMode): void;
  /** Place the orbit camera; target defaults to the current orbit target. */
  setView(position: Vec3, target?: Vec3, fovDeg?: number): void;
  setRpm(rpm: number | number[]): void;
  /** Set every rotor (or each, M1..M4) to an absolute angle in degrees. */
  setRotorAngles(deg: number | number[]): void;
  /** Stop the simulation clock (rendering continues); step() advances it. */
  freeze(frozen: boolean): void;
  step(dtS: number): void;
  setSpinArrows(visible: boolean): void;
  setPayloadVisible(visible: boolean): void;
  setLeds(fc: FcLedMode, vtx: VtxLedMode, rearStrip: boolean): void;
  rotors(): RotorInfo[];
  groundOffset(): number;
  /** World point → CSS pixel in the canvas (for annotating screenshots). */
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
    setRpm: (rpm) => drone.setRpm(rpm),
    setRotorAngles: (deg) => drone.rotors.forEach((r, i) => r.setAngle(each(deg, i) * DEG)),
    freeze: (f) => (app.simFrozen = f),
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
    project(world) {
      app.camera.updateMatrixWorld();
      const v = app.camera.position
        .clone()
        .set(...world)
        .project(app.camera);
      const { clientWidth: w, clientHeight: h } = app.renderer.domElement;
      return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
    },
  };
}
