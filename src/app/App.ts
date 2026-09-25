import {
  AgXToneMapping,
  Box3,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Timer,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { AudioFrame, Vec3 } from '../audio/AudioEngine';
import { LiveAudio } from '../audio/LiveAudio';
import { LEDS, PROP_BLEND } from '../config/drone';
import { QUALITY, RENDER, type QualityPreset } from '../config/render';
import { DroneModel } from '../drone/DroneModel';
import { createBench } from '../render/bench';
import { createEnvironment, type Environment } from '../render/environment';
import { aimKeyLight, createKeyLight, setShadowMapSize } from '../render/lighting';
import { PostPipeline } from '../render/pipeline';
import { QualityController } from '../render/quality';
import { KeyboardInput } from '../input/KeyboardInput';
import { Powertrain } from '../sim/Powertrain';
import type { PowerEvent } from '../sim/PowerStateMachine';
import { mountAudioPrompt } from '../ui/AudioPrompt';
import { readParams } from './params';
import { exposeDebug } from './debug';

export class App {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly quality: QualityController;
  drone!: DroneModel;
  environment!: Environment;
  readonly powertrain = new Powertrain();
  readonly input = new KeyboardInput();
  readonly audio = new LiveAudio();
  /** Debug/verification: fixed prop RPM instead of the motor model (null = model). */
  rpmOverride: number[] | null = null;
  /** Debug/verification: fixed throttle instead of the keyboard (null = keyboard). */
  throttleOverride: number | null = null;
  /** When frozen, the simulation clock stops but frames keep rendering (for screenshots). */
  simFrozen = false;
  /** Power events from the last frame (debug/HUD). */
  lastEvents: PowerEvent[] = [];
  private prevRpms = [0, 0, 0, 0];
  private v = new Vector3();
  private pendingStep = 0;
  private post: PostPipeline;
  private key;
  private padTopY = 0;
  private timer = new Timer();
  private running = false;

  static async create(container: HTMLElement): Promise<App> {
    const renderer = new WebGPURenderer({ antialias: false });
    await renderer.init();
    const app = new App(container, renderer);
    await app.load();
    app.start();
    return app;
  }

  private constructor(
    private container: HTMLElement,
    readonly renderer: WebGPURenderer,
  ) {
    const params = readParams();
    renderer.toneMapping = AgXToneMapping;
    renderer.toneMappingExposure = RENDER.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(renderer.domElement);

    const { camera: cam, orbit } = RENDER;
    this.camera = new PerspectiveCamera(cam.fov, 1, cam.near, cam.far);
    this.camera.position.set(...cam.position);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = orbit.damping;
    this.controls.minDistance = orbit.minDistance;
    this.controls.maxDistance = orbit.maxDistance;
    this.controls.autoRotateSpeed = orbit.autoRotateSpeed;

    this.quality = new QualityController({
      forced: params.quality,
      dynamicResolution: params.dynamicResolution,
      onPreset: (p) => this.applyPreset(p),
      onScale: () => this.resize(),
    });
    this.key = createKeyLight(this.scene, QUALITY[this.quality.preset].shadowMapSize);
    this.post = new PostPipeline(renderer, this.scene, this.camera);
    this.post.build(QUALITY[this.quality.preset]);

    this.timer.connect(document);
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
    mountAudioPrompt(this.audio);
    this.resize();
  }

  private async load(): Promise<void> {
    const params = readParams();
    const bench = createBench();
    this.padTopY = bench.padTopY;
    this.scene.add(bench.group);
    const [env, drone] = await Promise.all([createEnvironment(this.scene), DroneModel.load()]);
    this.environment = env;
    if (params.background) env.setBackground(params.background);

    this.drone = drone;
    this.scene.add(drone.root);
    drone.onGroundOffsetChange = (offset) => (drone.root.position.y = this.padTopY + offset);
    drone.root.position.y = this.padTopY + drone.groundOffset;
    drone.setSpinArrowsVisible(params.spinArrows);
    if (params.rpm !== null) this.rpmOverride = [params.rpm, params.rpm, params.rpm, params.rpm];

    const center = new Box3().setFromObject(drone.body).getCenter(new Vector3());
    this.controls.target.copy(center);
    this.controls.update();
    aimKeyLight(this.key, center);

    // Compile the translucent prop variants now, not on the first spin-up.
    drone.warmUp();
    this.post.render();
    drone.update(0);
    exposeDebug(this);
  }

  applyPreset(preset: QualityPreset): void {
    this.quality.preset = preset;
    const q = QUALITY[preset];
    setShadowMapSize(this.key, q.shadowMapSize);
    this.post.build(q);
    this.resize();
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    const dpr = Math.min(window.devicePixelRatio, QUALITY[this.quality.preset].maxPixelRatio);
    this.renderer.setPixelRatio(dpr * this.quality.scale);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer.reset();
    void this.renderer.setAnimationLoop(() => this.frame());
    this.audio.resume();
  }

  /** Hidden tab: stop rendering and the simulation, and silence the (frozen) motors. */
  stop(): void {
    this.running = false;
    void this.renderer.setAnimationLoop(null);
    this.audio.pause();
  }

  /** Advance the frozen simulation by dt on the next frame. */
  step(dt: number): void {
    this.pendingStep += dt;
  }

  private frame(): void {
    this.timer.update();
    // Clamp both ways: long gaps (tab switch) and clock-base mismatches on the first frame.
    const dt = Math.min(Math.max(this.timer.getDelta(), 0), RENDER.maxFrameDtS);
    this.quality.update(dt);
    this.controls.update(dt);

    const simDt = this.simFrozen ? this.pendingStep : dt;
    this.pendingStep = 0;
    const pt = this.powertrain;
    const controls = this.input.poll(dt);
    for (const a of controls.actions) {
      if (a === 'plugToggle') pt.togglePlug();
      else if (a === 'armToggle') pt.toggleArm();
      else if (a === 'kill') pt.kill();
      else if (a === 'beaconToggle') pt.toggleBeacon();
      else if (a === 'payloadToggle') this.drone.setPayloadVisible(!this.drone.payload.visible);
    }
    pt.throttle = this.throttleOverride ?? controls.throttle;
    this.lastEvents = pt.update(simDt);

    const rpms = this.rpmOverride ?? pt.rpms;
    this.drone.setRpm(rpms);
    this.drone.update(simDt, this.simFrozen ? PROP_BLEND.nominalFrameDtS : dt);
    this.updateLeds();
    this.audio.update(this.audioFrame(simDt, rpms));
    this.prevRpms = [...rpms];
    this.post.render();
  }

  /** FC LED: solid when powered, blinking when armed. VTX LED: red while booting, then green. */
  private updateLeds(): void {
    const s = this.powertrain.power.state;
    const leds = this.drone.leds;
    leds.setFc(s === 'OFF' ? 'off' : this.powertrain.power.armed ? 'blink' : 'solid');
    leds.setVtx(s === 'OFF' ? 'off' : s === 'BOOTING' ? 'red' : 'green');
  }

  private world(local: Vec3): Vec3 {
    const w = this.drone.body.localToWorld(this.v.set(...local));
    return [w.x, w.y, w.z];
  }

  private audioFrame(dt: number, rpms: readonly number[]): AudioFrame {
    const pt = this.powertrain;
    const motors = pt.motors.motors;
    const rates = this.rpmOverride
      ? rpms.map((r, i) => (dt > 0 ? (r - this.prevRpms[i]) / dt : 0))
      : motors.map((m) => m.rpmRate);
    const cam = this.camera;
    const fwd = cam.getWorldDirection(new Vector3());
    const up = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    return {
      dt,
      rpms,
      rpmRates: rates,
      driven: pt.power.armed,
      events: this.lastEvents,
      beacon: pt.power.beacon,
      lowBattery: pt.power.powered && pt.battery.lowWarning,
      rotorPositions: this.drone.rotors.map((r) => {
        const p = r.pivot.getWorldPosition(new Vector3());
        return [p.x, p.y, p.z] as const;
      }),
      framePosition: this.world(LEDS.fc.position),
      listener: {
        position: [cam.position.x, cam.position.y, cam.position.z],
        forward: [fwd.x, fwd.y, fwd.z],
        up: [up.x, up.y, up.z],
      },
      cameraMode: 'orbit',
      distance: cam.position.distanceTo(this.controls.target),
    };
  }

  get backend(): 'webgpu' | 'webgl2' {
    return (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  }
}
