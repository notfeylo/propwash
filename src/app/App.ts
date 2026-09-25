import {
  AgXToneMapping,
  Box3,
  Group,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Timer,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { QUALITY, RENDER, type QualityPreset } from '../config/render';
import { loadDrone } from '../drone/loadDrone';
import { createBench } from '../render/bench';
import { createEnvironment, type Environment } from '../render/environment';
import { aimKeyLight, createKeyLight, setShadowMapSize } from '../render/lighting';
import { PostPipeline } from '../render/pipeline';
import { QualityController } from '../render/quality';
import { readParams } from './params';
import { exposeDebug } from './debug';

export class App {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly quality: QualityController;
  readonly droneRoot = new Group();
  environment!: Environment;
  private post: PostPipeline;
  private key;
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

    this.droneRoot.name = 'drone_root';
    this.scene.add(this.droneRoot);
    this.timer.connect(document);
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
    this.resize();
  }

  private async load(): Promise<void> {
    const params = readParams();
    const bench = createBench();
    this.scene.add(bench.group);
    const [env, drone] = await Promise.all([createEnvironment(this.scene), loadDrone()]);
    this.environment = env;
    if (params.background) env.setBackground(params.background);

    this.droneRoot.add(drone);
    // Rest the lowest visible part on the pad.
    const box = new Box3().setFromObject(drone);
    this.droneRoot.position.y = bench.padTopY - box.min.y;
    const center = new Box3().setFromObject(this.droneRoot).getCenter(new Vector3());
    this.controls.target.copy(center);
    this.controls.update();
    aimKeyLight(this.key, center);
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
    void this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  stop(): void {
    this.running = false;
    void this.renderer.setAnimationLoop(null);
  }

  /** Advance simulation-side state by dt seconds. */
  update(dt: number): void {
    this.controls.update(dt);
  }

  private frame(timestamp: number): void {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), RENDER.maxFrameDtS);
    this.quality.update(dt);
    this.update(dt);
    this.post.render();
  }

  get backend(): 'webgpu' | 'webgl2' {
    return (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  }
}
