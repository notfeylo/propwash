import type { Object3D } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DRONE } from '../config/drone';

export interface DroneMounts {
  fpvCam: [number, number, number];
  hdCam: [number, number, number];
}

export async function loadDrone(url: string = DRONE.modelUrl): Promise<Object3D> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  const drone = gltf.scene.getObjectByName('drone');
  if (!drone) throw new Error(`${url}: node "drone" not found`);
  drone.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return drone;
}
