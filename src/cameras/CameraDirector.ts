import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three/webgpu';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERAS, type CameraMode, type FeedStyle, type HdStabilization, isFeedView, toRad } from '../config/cameras';
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
  /** The drone (flight): what Chase and LOS follow. */
  target?: { position: Vector3; quaternion: Quaternion; velocity: Vector3 };
  /** Free distance along a ray (world), for the chase camera's no-clip (m). */
  castRay?: (from: Vector3, dir: Vector3, maxM: number) => number;
  /** Ground height under (x, z). */
  groundAt?: (x: number, z: number) => number;
  /** The pilot's ground (the pad top), for the LOS camera. */
  padTopY?: number;
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
  readonly chase: PerspectiveCamera;
  readonly los: PerspectiveCamera;
  /** HD stabilization mode (raw, smooth, horizon lock). */
  hdStabilization: HdStabilization = CAMERAS.hd.stabilization.default;
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
  private chaseVel = new Vector3();
  /** The target's motion as this view sees it (per rendered second: replays play slow or pause). */
  private targetVel = new Vector3();
  private lastTarget = new Vector3();
  private chaseHeading = 0;
  private chaseReady = false;
  private losFov: number = CAMERAS.los.fovRangeDeg[1];
  private losReady = false;
  private hdSmooth = new Quaternion();
  private hdReady = false;
  private lastDt = 1 / 60;
  private m4 = new Matrix4();
  private va = new Vector3();
  private vb = new Vector3();
  private vc = new Vector3();
  private qa = new Quaternion();

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
    this.chase = new PerspectiveCamera(CAMERAS.chase.fovDeg, 1, CAMERAS.chase.near, H.far);
    this.chase.name = 'chase_camera';
    this.los = new PerspectiveCamera(CAMERAS.los.fovRangeDeg[1], 1, CAMERAS.los.near, H.far);
    this.los.name = 'los_camera';
    this.setUptilt(this.uptiltDeg);
    this.sync();
  }

  attach(drone: DroneModel): void {
    drone.mounts.fpvCam.add(this.fpv);
    drone.mounts.hdCam.add(this.hd);
  }

  get active(): PerspectiveCamera {
    const m = this.mode;
    return m === 'fpv'
      ? this.fpv
      : m === 'hd'
        ? this.hd
        : m === 'chase'
          ? this.chase
          : m === 'los'
            ? this.los
            : this.orbit;
  }

  /** Outside views (orbit, chase, LOS) render clean, full screen. */
  get lookKind(): LookKind {
    return this.mode === 'fpv' ? this.feed : this.mode === 'hd' ? 'hd' : 'orbit';
  }

  get aspect(): number {
    if (this.mode === 'fpv') return this.feed === 'analog' ? CAMERAS.analog.aspect : CAMERAS.digital.aspect;
    if (this.mode === 'hd') return CAMERAS.hd.aspect;
    return this.width / this.height;
  }

  /** The outside views jump to the drone instead of swinging over (after a reset or replay seek). */
  snapFollowers(): void {
    this.chaseReady = false;
    this.losReady = false;
    this.hdReady = false;
  }

  /** Cycle HD stabilization: raw → smooth → horizon lock. */
  cycleHdStabilization(): HdStabilization {
    const order: HdStabilization[] = ['raw', 'smooth', 'horizon'];
    this.hdStabilization = order[(order.indexOf(this.hdStabilization) + 1) % order.length];
    this.hdReady = false;
    return this.hdStabilization;
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
    for (const c of [this.orbit, this.chase, this.los]) {
      c.aspect = this.width / this.height;
      c.updateProjectionMatrix();
    }
    this.sync();
  }

  update(dt: number, f: DirectorFrame): void {
    const u = this.look;
    this.lastDt = dt;
    if (f.target) {
      this.updateChase(dt, f);
      this.updateLos(dt, f);
    }
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

  /**
   * Chase: a critically damped spring pulls the camera to a point behind (by heading) and above
   * the drone; it aims ahead along the velocity. A ray from the drone back to the camera keeps it
   * in front of whatever is in between, and it never goes below the ground.
   */
  private updateChase(dt: number, f: DirectorFrame): void {
    const C = CAMERAS.chase;
    const t = f.target!;
    const cam = this.chase;
    // Heading from the drone's nose projected on the ground (kept while it points straight up/down).
    const nose = this.va.set(0, 0, -1).applyQuaternion(t.quaternion);
    const flat = Math.hypot(nose.x, nose.z);
    const moving = Math.hypot(t.velocity.x, t.velocity.z);
    let heading = this.chaseHeading;
    if (flat > 0.25) heading = Math.atan2(nose.x, -nose.z);
    else if (moving > 2) heading = Math.atan2(t.velocity.x, -t.velocity.z);
    if (!this.chaseReady) this.chaseHeading = heading;
    const dh = Math.atan2(Math.sin(heading - this.chaseHeading), Math.cos(heading - this.chaseHeading));
    this.chaseHeading += dh * (1 - Math.exp(-dt * C.headingRads));
    const back = this.vb.set(-Math.sin(this.chaseHeading), 0, Math.cos(this.chaseHeading));
    const desired = this.vc.copy(t.position).addScaledVector(back, C.distanceM);
    desired.y += C.heightM;

    if (!this.chaseReady || cam.position.distanceTo(desired) > C.snapM) {
      cam.position.copy(desired);
      this.chaseVel.set(0, 0, 0);
      this.targetVel.set(0, 0, 0);
      this.chaseReady = true;
    } else {
      if (dt > 0) this.targetVel.copy(t.position).sub(this.lastTarget).divideScalar(dt);
      if (this.targetVel.length() > C.maxFollowMs) this.targetVel.setLength(C.maxFollowMs);
      const w = C.springRads;
      // v' = ω²(x* − x) + 2ω(v* − v): damped toward the drone's own velocity, so steady flight
      // leaves no lag, only the spring's give on changes. Semi-implicit Euler.
      const acc = this.va
        .copy(desired)
        .sub(cam.position)
        .multiplyScalar(w * w)
        .addScaledVector(this.targetVel, 2 * w)
        .addScaledVector(this.chaseVel, -2 * w);
      this.chaseVel.addScaledVector(acc, dt);
      cam.position.addScaledVector(this.chaseVel, dt);
    }
    // No-clip: between the drone and the camera there must be free space.
    if (f.castRay) {
      const dir = this.va.copy(cam.position).sub(t.position);
      const d = dir.length();
      if (d > 1e-3) {
        dir.divideScalar(d);
        const free = f.castRay(t.position, dir, d + C.clipMarginM);
        if (free < d + C.clipMarginM)
          cam.position.copy(t.position).addScaledVector(dir, Math.max(0.2, free - C.clipMarginM));
      }
    }
    if (f.groundAt) {
      const g = f.groundAt(cam.position.x, cam.position.z) + C.minAboveGroundM;
      if (cam.position.y < g) cam.position.y = g;
    }
    this.lastTarget.copy(t.position);
    const lead = this.vb.copy(this.targetVel).multiplyScalar(C.lookAheadS);
    if (lead.length() > C.lookAheadMaxM) lead.setLength(C.lookAheadMaxM);
    cam.lookAt(this.vc.copy(t.position).add(lead));
    cam.updateMatrixWorld(true);
  }

  /** LOS: the pilot standing by the pad, turning their head to the drone, zooming with distance. */
  private updateLos(dt: number, f: DirectorFrame): void {
    const L = CAMERAS.los;
    const t = f.target!;
    const cam = this.los;
    const [px, py, pz] = L.position;
    cam.position.set(px, (f.padTopY ?? 0) + py, pz);
    const d = Math.max(0.5, cam.position.distanceTo(t.position));
    const fovTarget = Math.min(
      L.fovRangeDeg[1],
      Math.max(L.fovRangeDeg[0], (2 * Math.atan(L.subjectM / L.fill / 2 / d) * 180) / Math.PI),
    );
    // Aim: rotate toward the drone with a short time constant (the head keeps up; no jitter).
    this.m4.lookAt(cam.position, t.position, this.va.set(0, 1, 0));
    this.qa.setFromRotationMatrix(this.m4);
    if (!this.losReady) {
      cam.quaternion.copy(this.qa);
      this.losFov = fovTarget;
      this.losReady = true;
    } else {
      cam.quaternion.slerp(this.qa, 1 - Math.exp(-dt / L.aimTauS));
      this.losFov += (fovTarget - this.losFov) * (1 - Math.exp(-dt / L.zoomTauS));
    }
    cam.fov = this.losFov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  /**
   * HD stabilization, from the camera's known attitude (Gyroflow-style): the raw orientation is
   * smoothed; horizon lock also levels the roll. The frame crops in to hide the rotated edges.
   */
  private stabilizedHd(raw: Quaternion): Quaternion {
    const S = CAMERAS.hd.stabilization;
    if (this.hdStabilization === 'raw') return raw;
    if (!this.hdReady) {
      this.hdSmooth.copy(raw);
      this.hdReady = true;
    } else this.hdSmooth.slerp(raw, 1 - Math.exp(-this.lastDt / S.smoothTauS));
    if (this.hdStabilization === 'smooth') return this.hdSmooth;
    // Horizon lock: look where the smoothed camera looks, with world up (roll removed). Pointing
    // almost straight up or down, the level is undefined: keep the smoothed view there.
    const fwd = this.va.set(0, 0, -1).applyQuaternion(this.hdSmooth);
    if (Math.abs(fwd.y) > 0.97) return this.hdSmooth;
    this.m4.lookAt(this.vb.set(0, 0, 0), fwd, this.vc.set(0, 1, 0));
    return this.qa.setFromRotationMatrix(this.m4);
  }

  private apply(mode: CameraMode): void {
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    if (mode === 'hd') this.hdReady = false;
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
    const stabilized = this.mode === 'hd' && this.hdStabilization !== 'raw';
    if (this.mode === 'hd') r.quaternion.copy(this.stabilizedHd(r.quaternion));
    // The scene renders at the screen's aspect (TRAA's jitter resets the camera to it), framed
    // so the feed's video box covers exactly the lens field of view; the look crops the box.
    const a = this.aspect;
    const box = this.videoBox;
    const boxH = box.height / this.height;
    let fov = cam.fov;
    if (isFeedView(this.mode)) {
      let feedFov = vfov(this.mode === 'fpv' ? CAMERAS.fpv.hfovDeg : CAMERAS.hd.hfovDeg, a);
      if (stabilized)
        feedFov = (2 * Math.atan(Math.tan(toRad(feedFov) / 2) * CAMERAS.hd.stabilization.crop)) / (Math.PI / 180);
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
