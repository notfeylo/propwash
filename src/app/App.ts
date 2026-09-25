import {
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RENDER } from '../config/render';
import { loadDrone } from '../drone/loadDrone';

declare global {
  interface Window {
    __propwash?: { ready: boolean; backend: string; triangles: number };
  }
}

// Phase 1 placeholder viewer: loads the drone so the asset pipeline can be checked visually.
// Task 2 replaces the lighting and adds the bench set + post pipeline.
export async function startApp(container: HTMLElement): Promise<void> {
  const renderer = new WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMappingExposure = RENDER.exposure;
  container.appendChild(renderer.domElement);
  await renderer.init();

  const scene = new Scene();
  scene.background = new Color(RENDER.background);

  const { camera: cam, orbit, light } = RENDER;
  const camera = new PerspectiveCamera(cam.fov, container.clientWidth / container.clientHeight, cam.near, cam.far);
  camera.position.set(...cam.position);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = orbit.damping;
  controls.minDistance = orbit.minDistance;
  controls.maxDistance = orbit.maxDistance;

  scene.add(new HemisphereLight(light.hemisphere.sky, light.hemisphere.ground, light.hemisphere.intensity));
  const key = new DirectionalLight(light.key.color, light.key.intensity);
  key.position.set(...light.key.position);
  scene.add(key);

  const drone = await loadDrone();
  scene.add(drone);
  controls.target.copy(new Box3().setFromObject(drone).getCenter(new Vector3()));
  controls.update();

  const onResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', onResize);

  await renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  window.__propwash = { ready: true, backend, triangles: renderer.info.render.triangles };
}
