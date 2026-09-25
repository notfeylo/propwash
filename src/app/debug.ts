import type { App } from './App';
import type { BackgroundMode, QualityPreset } from '../config/render';

export interface DebugHandle {
  ready: boolean;
  backend: 'webgpu' | 'webgl2';
  readonly preset: QualityPreset;
  readonly scale: number;
  setQuality(preset: QualityPreset): void;
  setBackground(mode: BackgroundMode): void;
  /** Place the orbit camera; target defaults to the current orbit target. */
  setView(position: [number, number, number], target?: [number, number, number]): void;
}

declare global {
  interface Window {
    __propwash?: DebugHandle;
    /** Dev builds only: the live App, for poking at state from the console. */
    __app?: App;
  }
}

/** Handle used by the Playwright smoke test and the verification screenshots. */
export function exposeDebug(app: App): void {
  if (import.meta.env.DEV) window.__app = app;
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
    setView(position, target) {
      if (target) app.controls.target.set(...target);
      app.camera.position.set(...position);
      app.controls.update();
    },
  };
}
