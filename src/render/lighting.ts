import { DirectionalLight, type Object3D, type Scene, Vector3 } from 'three/webgpu';
import { LIGHTS } from '../config/render';

/** One soft-shadowed key light; the HDRI supplies fill and reflections. */
export function createKeyLight(scene: Scene, shadowMapSize: number): DirectionalLight {
  const cfg = LIGHTS.key;
  const key = new DirectionalLight(cfg.color, cfg.intensity);
  key.name = 'key_light';
  key.castShadow = true;
  const cam = key.shadow.camera;
  cam.left = cam.bottom = -cfg.shadowHalfExtentM;
  cam.right = cam.top = cfg.shadowHalfExtentM;
  cam.near = cfg.shadowNear;
  cam.far = cfg.shadowFar;
  key.shadow.bias = cfg.shadowBias;
  key.shadow.normalBias = cfg.shadowNormalBias;
  key.shadow.radius = cfg.shadowRadius;
  setShadowMapSize(key, shadowMapSize);
  scene.add(key, key.target);
  return key;
}

export function setShadowMapSize(light: DirectionalLight, size: number): void {
  if (light.shadow.mapSize.x === size) return;
  light.shadow.mapSize.set(size, size);
  light.shadow.map?.dispose();
  light.shadow.map = null;
}

/** Keep the tight shadow frustum centered on the subject. */
export function aimKeyLight(light: DirectionalLight, subject: Object3D | Vector3): void {
  const center = subject instanceof Vector3 ? subject : subject.getWorldPosition(new Vector3());
  light.target.position.copy(center);
  light.position.copy(center).add(new Vector3(...LIGHTS.key.position));
  light.target.updateMatrixWorld();
  light.updateMatrixWorld();
}
