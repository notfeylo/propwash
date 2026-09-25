import { Color, EquirectangularReflectionMapping, type DataTexture, type Scene } from 'three/webgpu';
import {
  cameraPosition,
  cos,
  float,
  length,
  fog,
  mix,
  pmremTexture,
  positionWorld,
  screenUV,
  sin,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { ENVIRONMENT, type BackgroundMode } from '../config/render';

export interface Environment {
  texture: DataTexture;
  background: BackgroundMode;
  setBackground(mode: BackgroundMode): void;
}

/**
 * Image-based lighting from a CC0 HDRI, with either a blurred-HDRI or neutral-gradient
 * backdrop. Distant floor fades into exactly the background color behind it, so there is
 * no visible horizon edge in either mode.
 */
export async function createEnvironment(scene: Scene): Promise<Environment> {
  const texture = await new HDRLoader().loadAsync(ENVIRONMENT.hdriUrl);
  texture.mapping = EquirectangularReflectionMapping;
  scene.environment = texture;
  scene.environmentIntensity = ENVIRONMENT.intensity;
  scene.environmentRotation.set(0, ENVIRONMENT.rotationY, 0);
  scene.backgroundRotation.set(0, ENVIRONMENT.rotationY, 0);

  const { bottom, top } = ENVIRONMENT.gradient;
  const b = new Color(bottom);
  const t = new Color(top);
  const gradient = mix(vec3(b.r, b.g, b.b), vec3(t.r, t.g, t.b), screenUV.y.oneMinus().pow(1.4));

  // Same lookup the renderer uses for a blurred, rotated, dimmed HDRI background.
  const { blurriness, intensity } = ENVIRONMENT.hdriBackground;
  const d = positionWorld.sub(cameraPosition).normalize();
  const yaw = ENVIRONMENT.rotationY;
  const rotated = vec3(
    d.x.mul(cos(yaw)).add(d.z.mul(sin(yaw))),
    d.y,
    d.x.mul(sin(yaw).negate()).add(d.z.mul(cos(yaw))),
  );
  const hdriBehind = pmremTexture(texture, rotated, float(blurriness)).rgb.mul(intensity);

  const hdriMode = uniform(0);
  // Fade by distance from the pad, not view depth: the set dissolves into the backdrop like a
  // studio cove, and nothing near the drone is ever fogged.
  const { startM, endM } = ENVIRONMENT.horizonFog;
  const fade = smoothstep(float(startM), float(endM), length(positionWorld.xz));
  scene.fogNode = fog(mix(gradient, hdriBehind, hdriMode), fade);

  const env: Environment = {
    texture,
    background: ENVIRONMENT.background,
    setBackground(mode) {
      env.background = mode;
      hdriMode.value = mode === 'hdri' ? 1 : 0;
      if (mode === 'hdri') {
        scene.backgroundNode = null;
        scene.background = texture;
        scene.backgroundBlurriness = blurriness;
        scene.backgroundIntensity = intensity;
      } else {
        scene.background = null;
        scene.backgroundNode = gradient;
      }
    },
  };
  env.setBackground(ENVIRONMENT.background);
  return env;
}
