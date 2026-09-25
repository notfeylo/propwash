import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERAS, type CameraMode, type FeedStyle, toRad } from '../config/cameras';
import type { DroneModel } from '../drone/DroneModel';
import type { LookKind, LookUniforms } from '../render/cameraLook';

/** Video area in CSS pixels, for overlays drawn on top of the feed (OSD, REC). */
export interface VideoBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DirectorFrame {
  /** The FPV camera has video (drone powered). */
  fpvSignal: boolean;
  /** Frame vibration 0..1, for HD jello. */
  vibration: number;
}

const vfov = (hfovDeg: number, aspect: number) =>
  (2 * Math.atan(Math.tan(toRad(hfovDeg) / 2) / aspect)) / (Math.PI / 180);

/**
 * Orbit → FPV → HD (PRD §4.6). The post pipeline renders one camera, `renderCamera`; each frame
 * it takes the active view's world transform and projection. FPV and HD cameras are parented to
 * the drone's mounts, which ride on the vibrating body, so the feed shakes with the frame.
 * Switching dips through black (and optionally whip-pans) over `CAMERAS.cut.durationS`.
 */
export class CameraDirector {
  readonly renderCamera = new PerspectiveCamera();
  readonly fpv: PerspectiveCamera;
  readonly hd: PerspectiveCamera;
  mode: CameraMode = 'orbit';
  feed: FeedStyle = CAMERAS.fpv.defaultFeed;
  uptiltDeg = CAMERAS.fpv.uptiltDeg;
  jello = CAMERAS.hd.jello.enabled;
  whipPan = CAMERAS.cut.whipPan;
  /** Called when a cut lands on a new view. */
  onChange?: (mode: CameraMode, feed: FeedStyle) => void;
  private cut: { t: number; to: CameraMode; switched: boolean; dir: number } | null = null;
  private width = 1;
  private height = 1;
  private scratch = new Vector3();

  constructor(
    readonly orbit: PerspectiveCamera,
    readonly controls: OrbitControls,
    private look: LookUniforms,
    private setView: (kind: LookKind) => void,
  ) {
    const F = CAMERAS.fpv;
    const H = CAMERAS.hd;
    this.fpv = new PerspectiveCamera(vfov(F.hfovDeg, CAMERAS.analog.aspect), CAMERAS.analog.aspect, F.near, F.far);
    this.fpv.name = 'fpv_camera';
    this.hd = new PerspectiveCamera(vfov(H.hfovDeg, H.aspect), H.aspect, H.near, H.far);
    this.hd.name = 'hd_camera';
    this.hd.rotation.x = -toRad(H.tiltDeg);
    this.setUptilt(this.uptiltDeg);
    this.sync();
  }

  attach(drone: DroneModel): void {
    drone.mounts.fpvCam.add(this.fpv);
    drone.mounts.hdCam.add(this.hd);
  }

  get active(): PerspectiveCamera {
    return this.mode === 'fpv' ? this.fpv : this.mode === 'hd' ? this.hd : this.orbit;
  }

  get lookKind(): LookKind {
    return this.mode === 'fpv' ? this.feed : this.mode;
  }

  get aspect(): number {
    if (this.mode === 'fpv') return this.feed === 'analog' ? CAMERAS.analog.aspect : CAMERAS.digital.aspect;
    if (this.mode === 'hd') return CAMERAS.hd.aspect;
    return this.width / this.height;
  }

  /** The feed's video area inside the canvas (pillar- or letterboxed), CSS px. */
  get videoBox(): VideoBox {
    const screen = this.width / this.height;
    const a = this.aspect;
    const width = a < screen ? this.height * a : this.width;
    const height = a < screen ? this.height : this.width / a;
    return { x: (this.width - width) / 2, y: (this.height - height) / 2, width, height };
  }

  /** Current dip-to-black of a cut, 0..1. */
  get fade(): number {
    return this.look.fade.value;
  }

  /** True while a cut is running (input can queue another). */
  get cutting(): boolean {
    return this.cut !== null;
  }

  cycle(): void {
    const order = CAMERAS.order;
    const from = this.cut?.to ?? this.mode;
    this.setMode(order[(order.indexOf(from) + 1) % order.length]);
  }

  setMode(mode: CameraMode, instant = false): void {
    if (instant || mode === this.mode) {
      this.cut = null;
      this.apply(mode);
      return;
    }
    const order = CAMERAS.order;
    const dir = order.indexOf(mode) > order.indexOf(this.mode) ? 1 : -1;
    this.cut = { t: 0, to: mode, switched: false, dir };
  }

  cycleFeed(): void {
    this.setFeed(this.feed === 'analog' ? 'digital' : 'analog');
  }

  setFeed(feed: FeedStyle): void {
    this.feed = feed;
    if (this.mode === 'fpv') this.apply('fpv');
  }

  setUptilt(deg: number): void {
    const [lo, hi] = CAMERAS.fpv.uptiltRangeDeg;
    this.uptiltDeg = Math.min(hi, Math.max(lo, deg));
    this.fpv.rotation.x = toRad(this.uptiltDeg);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.orbit.aspect = this.width / this.height;
    this.orbit.updateProjectionMatrix();
    this.sync();
  }

  update(dt: number, f: DirectorFrame): void {
    const u = this.look;
    if (this.cut) {
      const c = this.cut;
      const half = CAMERAS.cut.durationS / 2;
      c.t += dt;
      if (!c.switched && c.t >= half) {
        c.switched = true;
        this.apply(c.to);
      }
      const p = Math.min(1, c.t / (2 * half));
      const tri = 1 - Math.abs(2 * p - 1); // 0 → 1 at the switch → 0
      u.fade.value = tri;
      // Whip: slide out one way, arrive from the other side.
      u.whip.value = this.whipPan ? c.dir * CAMERAS.cut.whipAmount * (p < 0.5 ? tri : -tri) : 0;
      if (p >= 1) {
        this.cut = null;
        u.fade.value = 0;
        u.whip.value = 0;
      }
    }
    u.noSignal.value = this.mode === 'fpv' && !f.fpvSignal ? 1 : 0;
    u.jello.value = this.mode === 'hd' && this.jello ? CAMERAS.hd.jello.amount * Math.min(1, f.vibration * 4) : 0;
    this.sync();
  }

  private apply(mode: CameraMode): void {
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    this.setView(this.lookKind);
    this.sync();
    this.onChange?.(this.mode, this.feed);
  }

  /** Copy the active view into the render camera and the look's video box. */
  private sync(): void {
    const cam = this.active;
    const r = this.renderCamera;
    cam.updateWorldMatrix(true, false);
    cam.matrixWorld.decompose(r.position, r.quaternion, this.scratch);
    // The scene renders at the screen's aspect (TRAA's jitter resets the camera to it), framed
    // so the feed's video box covers exactly the lens field of view; the look crops the box.
    const a = this.aspect;
    const box = this.videoBox;
    const boxH = box.height / this.height;
    let fov = cam.fov;
    if (this.mode !== 'orbit') {
      const feedFov = vfov(this.mode === 'fpv' ? CAMERAS.fpv.hfovDeg : CAMERAS.hd.hfovDeg, a);
      fov = (2 * Math.atan(Math.tan(toRad(feedFov) / 2) / boxH)) / (Math.PI / 180);
    }
    r.fov = fov;
    r.aspect = this.width / this.height;
    r.near = cam.near;
    r.far = cam.far;
    r.updateProjectionMatrix();
    r.updateMatrixWorld(true);

    const u = this.look;
    u.boxMin.value.set(box.x / this.width, box.y / this.height);
    u.boxSize.value.set(box.width / this.width, boxH);
    u.boxAspect.value = a;
    u.barrelK.value = this.mode === 'fpv' ? CAMERAS.fpv.barrelK : this.mode === 'hd' ? CAMERAS.hd.barrelK : 0;
  }
}
