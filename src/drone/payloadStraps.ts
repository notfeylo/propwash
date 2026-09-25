import { Box3, type BufferGeometry, type Mesh, Vector3 } from 'three/webgpu';
import { subsetGeometry } from './geometry';

export interface StrapSplit {
  /** Body geometry without the straps. */
  body: BufferGeometry;
  /** The straps, sharing the body's vertex buffers. */
  straps: BufferGeometry;
  strapTriangles: number;
}

/**
 * The asset's split (tools/split-drone.mjs, verified and frozen) leaves the canister's
 * mounting straps in `body`, so hiding the payload left them dangling to the pad. Find the
 * loose parts of the body mesh that hang below the frame inside the canister's footprint and
 * move them into the payload group at load time. The .glb and its tri counts stay as verified.
 *
 * @param body the body mesh (quantized positions are fine; the mesh matrix is applied)
 * @param payloadBox the payload's bounds in the same space as body.matrix maps into
 * @param belowY a part must reach below this height (m) to count as hanging
 */
export function splitPayloadStraps(body: Mesh, payloadBox: Box3, belowY: number): StrapSplit | null {
  const g = body.geometry;
  const pos = g.getAttribute('position');
  const index = g.getIndex();
  if (!index) return null;
  body.updateMatrix();

  // Connected components over position-welded vertices (the source's loose parts).
  const key = new Map<string, number>();
  const weld = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`;
    const w = key.get(k);
    if (w === undefined) key.set(k, i);
    weld[i] = w ?? i;
  }
  const parent = Int32Array.from({ length: pos.count }, (_, i) => i);
  const find = (x: number) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let t = 0; t < index.count; t += 3) {
    const a = find(weld[index.getX(t)]);
    const b = find(weld[index.getX(t + 1)]);
    const c = find(weld[index.getX(t + 2)]);
    parent[a] = b;
    parent[find(b)] = c;
  }

  const v = new Vector3();
  const boxes = new Map<number, Box3>();
  for (let t = 0; t < index.count; t++) {
    const i = index.getX(t);
    const r = find(weld[i]);
    let b = boxes.get(r);
    if (!b) boxes.set(r, (b = new Box3()));
    b.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(body.matrix));
  }

  const footprint = payloadBox.clone().expandByScalar(0.004);
  const strapRoots = new Set<number>();
  for (const [r, b] of boxes) {
    const inside =
      b.min.x >= footprint.min.x &&
      b.max.x <= footprint.max.x &&
      b.min.z >= footprint.min.z &&
      b.max.z <= footprint.max.z;
    if (inside && b.min.y < belowY) strapRoots.add(r);
  }
  if (!strapRoots.size) return null;

  const keep: number[] = [];
  const strap: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    (strapRoots.has(find(weld[tri[0]])) ? strap : keep).push(...tri);
  }
  return { body: subsetGeometry(g, keep), straps: subsetGeometry(g, strap), strapTriangles: strap.length / 3 };
}
