import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  type Scene,
  SRGBColorSpace,
  Vector3,
} from 'three/webgpu';
import { color, float, fog, mix, positionLocal, rangeFogFactor, sin, time, uniform, uv, vec3, vec4 } from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { FIELD_RENDER, TERRAIN } from '../config/field';
import { mulberry32 } from '../sim/MotorModel';
import type { FieldLayout, FieldPrim, FieldRole } from '../world/fieldLayout';
import type { Terrain } from '../world/terrain';

// The test field's visuals (Phase 2 PRD §5): reference geometry for depth, speed and attitude, not
// the Phase 3 art pass. Built from the same terrain grid and object list the physics uses.

const ROLE_COLORS: Record<FieldRole, number> = {
  pole: 0xf06a1e,
  gatePost: 0xff4f1f,
  gateBar: 0xff4f1f,
  tower: 0x6d747c,
  towerTop: 0x9aa1a8,
  box: 0x9c7a4f,
  ramp: 0xb89b6c,
  trunk: 0x5a4030,
  canopy: 0x2f5a25,
  flagPole: 0xd8d8d8,
};

/** Tiled grass detail (canvas noise, original). */
function grassTexture(): CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const rand = mulberry32(99);
  const img = g.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = 0.78 + rand() * 0.32;
    img.data[i * 4] = 255 * v * 0.92;
    img.data[i * 4 + 1] = 255 * v;
    img.data[i * 4 + 2] = 255 * v * 0.85;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // Short strokes read as grass tufts at a distance.
  for (let k = 0; k < 2200; k++) {
    const x = rand() * n;
    const y = rand() * n;
    g.strokeStyle = `rgba(${rand() < 0.5 ? '40,70,20' : '150,160,90'},0.35)`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 4);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function terrainMesh(terrain: Terrain): Mesh {
  const n = terrain.cells + 1;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  const rand = mulberry32(TERRAIN.seed);
  const { dry, lush, dirt } = TERRAIN.colors;
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const x = -terrain.size / 2 + (ix / terrain.cells) * terrain.size;
      const z = -terrain.size / 2 + (iz / terrain.cells) * terrain.size;
      pos.set([x, terrain.heights[i], z], i * 3);
      uvs.set([x / 4, z / 4], i * 2);
      // Patchy lush/dry grass, dirt on steeper slopes.
      const slope = 1 - terrain.normalAt(x, z)[1];
      const w = 0.5 + 0.5 * Math.sin(x * 0.045 + Math.cos(z * 0.03) * 2) * Math.cos(z * 0.05);
      const d = Math.min(1, slope * 18);
      const jitter = 0.94 + rand() * 0.12;
      for (let k = 0; k < 3; k++) col[i * 3 + k] = ((lush[k] * w + dry[k] * (1 - w)) * (1 - d) + dirt[k] * d) * jitter;
    }
  // Same split as the collider: (00, 10, 11) and (00, 11, 01).
  const idx = new Uint32Array(terrain.cells * terrain.cells * 6);
  let k = 0;
  for (let iz = 0; iz < terrain.cells; iz++)
    for (let ix = 0; ix < terrain.cells; ix++) {
      const a = iz * n + ix;
      const b = a + 1;
      const c = a + n + 1;
      const d = a + n;
      idx.set([a, c, b, a, d, c], k);
      k += 6;
    }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setIndex(new BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mat = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.map = grassTexture();
  const mesh = new Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return mesh;
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpP = new Vector3();
const tmpS = new Vector3();

/** One InstancedMesh per role, sharing a unit geometry scaled per instance. */
function objectMeshes(prims: FieldPrim[]): Group {
  const group = new Group();
  group.name = 'field_objects';
  const byRole = new Map<FieldRole, FieldPrim[]>();
  for (const p of prims) byRole.set(p.role, [...(byRole.get(p.role) ?? []), p]);
  for (const [role, list] of byRole) {
    const shape = list[0].shape;
    const geo =
      shape === 'box'
        ? new BoxGeometry(2, 2, 2)
        : shape === 'cylinder'
          ? new CylinderGeometry(1, 1, 2, 12)
          : new IcosahedronGeometry(1, 1);
    const mat = new MeshStandardNodeMaterial({
      color: ROLE_COLORS[role],
      roughness: role === 'gatePost' || role === 'gateBar' || role === 'pole' ? 0.55 : 0.85,
      flatShading: shape === 'ball',
    });
    const mesh = new InstancedMesh(geo, mat, list.length);
    mesh.name = `field_${role}`;
    mesh.castShadow = mesh.receiveShadow = true;
    list.forEach((p, i) => {
      tmpP.set(...p.position);
      tmpQ.set(...p.rotation);
      if (p.shape === 'box') tmpS.set(...p.halfExtents);
      else if (p.shape === 'cylinder') tmpS.set(p.radius, p.halfHeight, p.radius);
      else tmpS.setScalar(p.radius);
      mesh.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    });
    group.add(mesh);
  }
  return group;
}

/** Instanced grass cards in cells around the camera; refreshed when it moves a cell. */
class Grass {
  readonly mesh: InstancedMesh;
  private cx = NaN;
  private cz = NaN;

  constructor(private terrain: Terrain) {
    const g = FIELD_RENDER.grass;
    // A tapered blade: two triangles, base 3 cm wide, 1 m tall (scaled per instance).
    const geo = new BufferGeometry();
    geo.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-0.03, 0, 0, 0.03, 0, 0, 0.012, 0.6, 0, -0.012, 0.6, 0, 0, 1, 0]), 3),
    );
    geo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 0.6, 0, 0.6, 0.5, 1]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3, 3, 2, 4]);
    geo.computeVertexNormals();
    const mat = new MeshStandardNodeMaterial({ side: DoubleSide, roughness: 0.9 });
    // Darker at the root, lighter at the tip.
    mat.colorNode = mix(color(0x3a5a20), color(0x93a655), uv().y);
    this.mesh = new InstancedMesh(geo, mat, g.maxBlades);
    this.mesh.name = 'grass';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  update(camera: Vector3): void {
    const g = FIELD_RENDER.grass;
    const cx = Math.round(camera.x / (g.cellM * 8));
    const cz = Math.round(camera.z / (g.cellM * 8));
    if (cx === this.cx && cz === this.cz) return;
    this.cx = cx;
    this.cz = cz;
    const R = g.radiusM;
    const x0 = Math.floor((camera.x - R) / g.cellM);
    const z0 = Math.floor((camera.z - R) / g.cellM);
    const cells = Math.ceil((2 * R) / g.cellM);
    let n = 0;
    for (let i = 0; i < cells && n < g.maxBlades; i++)
      for (let j = 0; j < cells && n < g.maxBlades; j++) {
        const ix = x0 + i;
        const iz = z0 + j;
        // Stable per cell: the same blade stays put as the window slides.
        const r = mulberry32((ix * 73856093) ^ (iz * 19349663));
        const x = (ix + r()) * g.cellM;
        const z = (iz + r()) * g.cellM;
        if (Math.hypot(x - camera.x, z - camera.z) > R || Math.hypot(x, z) < 0.6) continue;
        const h = g.bladeHeightM[0] + r() * (g.bladeHeightM[1] - g.bladeHeightM[0]);
        tmpP.set(x, this.terrain.heightAt(x, z), z);
        tmpQ
          .setFromAxisAngle(new Vector3(0, 1, 0), r() * Math.PI)
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (r() - 0.5) * 0.5));
        tmpS.set(1, h, 1);
        this.mesh.setMatrixAt(n++, tmpM.compose(tmpP, tmpQ, tmpS));
      }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** A wind flag: the cloth turns downwind and streams harder with speed. */
class Flag {
  readonly group = new Group();
  private cloth: Mesh;
  private stream = uniform(0);

  constructor(base: [number, number, number], height: number) {
    this.group.position.set(...base);
    const geo = new PlaneGeometry(0.9, 0.55, 12, 4).translate(0.45, 0, 0);
    const mat = new MeshStandardNodeMaterial({ color: 0xe8e2d0, side: DoubleSide, roughness: 0.8 });
    // Ripple along the cloth, stronger toward the free edge and with wind speed.
    const u = uv().x;
    const wave = sin(u.mul(9).sub(time.mul(float(6).add(this.stream.mul(4)))))
      .mul(u)
      .mul(float(0.05).add(this.stream.mul(0.04)));
    mat.positionNode = positionLocal.add(vec3(0, wave.mul(0.4), wave));
    this.cloth = new Mesh(geo, mat);
    this.cloth.position.y = height - 0.3;
    this.cloth.castShadow = true;
    this.group.add(this.cloth);
  }

  /** @param wind world wind velocity (m/s) */
  update(wind: Vector3): void {
    const speed = Math.hypot(wind.x, wind.z);
    // Point the cloth (+X) downwind; limp and drooping in calm air.
    if (speed > 0.05) this.cloth.rotation.y = Math.atan2(-wind.z, wind.x);
    this.cloth.rotation.z = -Math.max(0, 1 - speed / 4) * 1.2;
    this.stream.value = Math.min(1, speed / 8);
  }
}

export interface FieldView {
  group: Group;
  /** Per frame: grass follows the camera, flags follow the wind. */
  update(camera: Vector3, wind: Vector3): void;
}

/**
 * Terrain, instanced grass near the camera, the reference objects, wind flags, a physical sky and
 * distance fog. Replaces the bench floor (the pad stays) while the flight sim runs.
 */
export function createField(scene: Scene, terrain: Terrain, layout: FieldLayout): FieldView {
  const group = new Group();
  group.name = 'field';
  group.add(terrainMesh(terrain));
  group.add(objectMeshes(layout.prims));
  const grass = new Grass(terrain);
  group.add(grass.mesh);
  const flags = layout.flags.map((f) => new Flag(f.base, f.heightM));
  for (const f of flags) group.add(f.group);

  const S = FIELD_RENDER.sky;
  const sky = new SkyMesh();
  sky.scale.setScalar(4000);
  sky.turbidity.value = S.turbidity;
  sky.rayleigh.value = S.rayleigh;
  sky.mieCoefficient.value = S.mieCoefficient;
  sky.mieDirectionalG.value = S.mieDirectionalG;
  const el = (S.sunElevationDeg * Math.PI) / 180;
  const az = (S.sunAzimuthDeg * Math.PI) / 180;
  sky.sunPosition.value.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
  sky.material.fog = false;
  const skyColor = sky.material.colorNode as unknown as { rgb: ReturnType<typeof vec3> };
  sky.material.colorNode = vec4(skyColor.rgb.mul(S.exposure), 1);
  group.add(sky);

  const F = FIELD_RENDER.fog;
  scene.fogNode = fog(color(new Color(F.color)), rangeFogFactor(F.nearM, F.farM));
  scene.background = null;
  scene.backgroundNode = null;
  scene.add(group);

  const w = new Vector3();
  return {
    group,
    update(camera, wind) {
      grass.update(camera);
      w.copy(wind);
      for (const f of flags) f.update(w);
    },
  };
}
