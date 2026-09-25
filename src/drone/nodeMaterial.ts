import { type Material, type MeshStandardMaterial, MeshStandardNodeMaterial } from 'three/webgpu';

/**
 * GLTFLoader returns a classic MeshStandardMaterial; the renderer converts it on the fly, but
 * node-only features (shadow masks, opacity nodes) need a real node material. Copies the PBR state.
 */
export function toStandardNodeMaterial(src: Material): MeshStandardNodeMaterial {
  const s = src as MeshStandardMaterial;
  const m = new MeshStandardNodeMaterial();
  m.name = s.name;
  m.color.copy(s.color);
  m.roughness = s.roughness;
  m.metalness = s.metalness;
  m.map = s.map;
  m.roughnessMap = s.roughnessMap;
  m.metalnessMap = s.metalnessMap;
  m.normalMap = s.normalMap;
  m.normalMapType = s.normalMapType;
  m.normalScale.copy(s.normalScale);
  m.aoMap = s.aoMap;
  m.aoMapIntensity = s.aoMapIntensity;
  m.emissive.copy(s.emissive);
  m.emissiveMap = s.emissiveMap;
  m.emissiveIntensity = s.emissiveIntensity;
  m.envMapIntensity = s.envMapIntensity;
  m.side = s.side;
  m.transparent = s.transparent;
  m.opacity = s.opacity;
  m.alphaTest = s.alphaTest;
  return m;
}
