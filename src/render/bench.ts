import { BufferAttribute, CircleGeometry, CylinderGeometry, Group, Mesh, MeshStandardNodeMaterial } from 'three/webgpu';
import { BENCH } from '../config/render';
import { concreteMaps, landingPadMaps } from './proceduralTextures';

export interface Bench {
  group: Group;
  /** Height of the pad's top surface; the drone rests here. */
  padTopY: number;
}

export function createBench(): Bench {
  const group = new Group();
  group.name = 'bench';

  // Concrete floor: large enough that the horizon fog (render/environment.ts) hides its edge.
  const { floor, pad } = BENCH;
  const floorGeo = new CircleGeometry(floor.radiusM, 96).rotateX(-Math.PI / 2);
  const pos = floorGeo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / floor.tileM;
    uv[i * 2 + 1] = pos.getZ(i) / floor.tileM;
  }
  floorGeo.setAttribute('uv', new BufferAttribute(uv, 2));
  const concrete = concreteMaps();
  const floorMat = new MeshStandardNodeMaterial({
    ...concrete,
    roughness: 1,
    metalness: 0,
  });
  const floorMesh = new Mesh(floorGeo, floorMat);
  floorMesh.name = 'floor';
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  // Landing pad: textured top disc + a thin dark side band.
  const padMaps = landingPadMaps();
  const top = new Mesh(
    new CircleGeometry(pad.radiusM, 160).rotateX(-Math.PI / 2).translate(0, pad.thicknessM, 0),
    new MeshStandardNodeMaterial({ ...padMaps, roughness: 1, metalness: 0 }),
  );
  top.name = 'pad_top';
  const side = new Mesh(
    new CylinderGeometry(pad.radiusM, pad.radiusM * 1.01, pad.thicknessM, 160, 1, true).translate(
      0,
      pad.thicknessM / 2,
      0,
    ),
    new MeshStandardNodeMaterial({ color: pad.colors.side, roughness: 0.85, metalness: 0 }),
  );
  side.name = 'pad_side';
  for (const m of [top, side]) {
    m.receiveShadow = true;
    m.castShadow = true;
    group.add(m);
  }

  return { group, padTopY: pad.thicknessM };
}
