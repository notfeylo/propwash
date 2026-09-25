import { Box3, BufferGeometry, Sphere, Vector3 } from 'three/webgpu';

/**
 * A geometry that draws a subset of `source`'s triangles, sharing its vertex buffers.
 * Bounds cover only the referenced vertices (computeBoundingBox would span the whole
 * shared buffer), so ground-offset and culling see the real extent of the subset.
 */
export function subsetGeometry(source: BufferGeometry, index: number[]): BufferGeometry {
  const out = new BufferGeometry();
  for (const [name, attr] of Object.entries(source.attributes)) out.setAttribute(name, attr);
  out.setIndex(index);
  const pos = source.getAttribute('position');
  const box = new Box3();
  const v = new Vector3();
  for (const i of index) box.expandByPoint(v.fromBufferAttribute(pos, i));
  out.boundingBox = box;
  out.boundingSphere = box.isEmpty() ? new Sphere() : box.getBoundingSphere(new Sphere());
  return out;
}
