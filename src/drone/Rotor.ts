import {
  InstancedMesh,
  Matrix4,
  Mesh,
  type MeshStandardNodeMaterial,
  type Object3D,
  type UniformNode,
  Vector3,
} from 'three/webgpu';
import { float, hash, instanceIndex, screenCoordinate, uniform } from 'three/tsl';
import { DRONE, PROP_BLEND, PROP_DISC } from '../config/drone';
import { subsetGeometry } from './geometry';
import { toStandardNodeMaterial } from './nodeMaterial';
import { keepVelocityBehind } from './velocity';
import { aliasedStep, propWeights, wrapAngle, type PropWeights } from './propBlend';
import { PropBlur } from './PropBlur';

export type SpinDirection = 'CW' | 'CCW';

const TAU = Math.PI * 2;

/** Split the rotor mesh's triangles into hub (bell, adapter, nut, decals) and blades by radius. */
function splitRotor(mesh: Mesh) {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const index = g.getIndex();
  if (!index) throw new Error(`${mesh.name}: expected indexed geometry`);
  mesh.updateMatrix();
  const v = new Vector3();
  const radius = new Float32Array(pos.count);
  const height = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
    radius[i] = Math.hypot(v.x, v.z);
    height[i] = v.y;
  }
  const hub: number[] = [];
  const blades: number[] = [];
  const hubCentroid = new Vector3();
  const seen = new Set<number>();
  let yMin = Infinity;
  let yMax = -Infinity;
  const bladeTip = new Vector3();
  let tipR = 0;
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    const isBlade = Math.max(radius[a], radius[b], radius[c]) > DRONE.hubRadiusM;
    (isBlade ? blades : hub).push(a, b, c);
    if (!isBlade)
      for (const i of [a, b, c])
        if (!seen.has(i)) {
          seen.add(i);
          hubCentroid.add(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix));
        }
    if (isBlade)
      for (const i of [a, b, c])
        if (radius[i] > DRONE.hubRadiusM) {
          yMin = Math.min(yMin, height[i]);
          yMax = Math.max(yMax, height[i]);
          if (radius[i] > tipR) {
            tipR = radius[i];
            bladeTip.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
          }
        }
  }
  return {
    hub: subsetGeometry(g, hub),
    blades: subsetGeometry(g, blades),
    bladePlaneY: (yMin + yMax) / 2,
    hubCentroid: hubCentroid.divideScalar(seen.size || 1),
    bladeTip,
  };
}

/** Shadow-pass dither: drop fragments so a shadow's density follows the layer's opacity. */
function ditherShadow(mat: MeshStandardNodeMaterial, opacity: UniformNode<'float', number>, instanced = false) {
  const seed = screenCoordinate.x.add(screenCoordinate.y.mul(4099));
  const n = instanced ? seed.add(float(instanceIndex).mul(911)) : seed;
  mat.maskShadowNode = hash(n).lessThan(opacity);
}

/**
 * One motor + prop. The mesh-less pivot (from the asset) sits exactly on the motor shaft;
 * only it rotates. Real blades, smear ghosts and the blur disc crossfade by RPM.
 */
export class Rotor {
  readonly name: string;
  /** Betaflight motor number, 1–4. */
  readonly motorIndex: number;
  readonly spin: SpinDirection;
  /** +1 = CCW from above (+Y rotation in three.js), −1 = CW. */
  readonly spinSign: 1 | -1;
  readonly pivot: Object3D;
  /** Bell, prop adapter, nut and bell decals: always opaque, spins with the pivot. */
  readonly hub: Mesh;
  readonly blades: Mesh;
  readonly ghosts: InstancedMesh;
  readonly blur: PropBlur;
  /** Rotor plane height above the pivot (m). */
  readonly bladePlaneY: number;
  /** Centroid of the hub vertices in pivot space; sits on the motor axis if the pivot is right. */
  readonly hubCentroid: Vector3;
  /** Outermost blade vertex in pivot space (tracks one blade tip for verification). */
  readonly bladeTip: Vector3;

  angle = 0;
  rpm = 0;
  weights: PropWeights = { mesh: 1, smear: 0, disc: 0 };

  private bladeMat: MeshStandardNodeMaterial;
  private ghostMat: MeshStandardNodeMaterial;
  private bladeOpacity = uniform(1);
  private ghostOpacity = uniform(0);
  private meshMatrix = new Matrix4();
  private tmp = new Matrix4();

  constructor(pivot: Object3D) {
    const mesh = pivot.children.find((c): c is Mesh => (c as Mesh).isMesh);
    if (!mesh) throw new Error(`${pivot.name}: rotor mesh child missing`);
    const ud = pivot.userData as { motor?: number; spin?: SpinDirection };
    if (!ud.motor || (ud.spin !== 'CW' && ud.spin !== 'CCW'))
      throw new Error(`${pivot.name}: motor/spin extras missing`);

    this.name = pivot.name;
    this.pivot = pivot;
    this.motorIndex = ud.motor;
    this.spin = ud.spin;
    this.spinSign = ud.spin === 'CCW' ? 1 : -1;

    const split = splitRotor(mesh);
    this.bladePlaneY = split.bladePlaneY;
    this.hubCentroid = split.hubCentroid;
    this.bladeTip = split.bladeTip;
    this.meshMatrix.copy(mesh.matrix);

    this.hub = mesh;
    this.hub.geometry = split.hub;
    this.hub.name = `${pivot.name}_hub`;

    this.bladeMat = toStandardNodeMaterial(mesh.material as MeshStandardNodeMaterial);
    ditherShadow(this.bladeMat, this.bladeOpacity);
    this.blades = new Mesh(split.blades, this.bladeMat);
    this.blades.name = `${pivot.name}_blades`;
    this.blades.matrixAutoUpdate = false;
    this.blades.matrix.copy(this.meshMatrix);
    this.blades.castShadow = this.blades.receiveShadow = true;
    this.blades.renderOrder = 1;
    pivot.add(this.blades);

    this.ghostMat = toStandardNodeMaterial(mesh.material as MeshStandardNodeMaterial);
    this.ghostMat.transparent = true;
    this.ghostMat.depthWrite = false;
    this.ghostMat.opacityNode = this.ghostOpacity;
    this.ghostMat.mrtNode = keepVelocityBehind();
    ditherShadow(this.ghostMat, this.ghostOpacity, true);
    this.ghosts = new InstancedMesh(split.blades, this.ghostMat, PROP_BLEND.ghosts);
    this.ghosts.name = `${pivot.name}_ghosts`;
    this.ghosts.castShadow = true;
    this.ghosts.frustumCulled = false;
    this.ghosts.renderOrder = 1;
    this.ghosts.visible = false;
    pivot.add(this.ghosts);

    // The disc lives in body space (it must not spin with the pivot).
    this.blur = new PropBlur(`${pivot.name}_blur`);
    this.blur.mesh.position.copy(pivot.position).add(new Vector3(0, this.bladePlaneY, 0));
    pivot.parent?.add(this.blur.mesh);
  }

  setPropColor(r: number, g: number, b: number): void {
    this.blur.color.value.setRGB(r, g, b);
  }

  /** Set the rotor angle directly (verification / debug). */
  setAngle(rad: number): void {
    this.angle = wrapAngle(rad);
    this.pivot.rotation.y = this.angle;
  }

  /**
   * @param dt simulation step (s); 0 while frozen.
   * @param frameDt time one rendered frame represents (s), which sizes the smear and the strobe.
   */
  update(dt: number, frameDt: number): void {
    const omega = (this.rpm / 60) * TAU; // rad/s, unsigned
    this.setAngle(this.angle + this.spinSign * omega * dt);

    const w = propWeights(this.rpm);
    this.weights = w;

    // Real blades: opaque at rest (so they stay in the AO prepass), blended while fading.
    const fading = w.mesh < 0.999;
    if (this.bladeMat.transparent !== fading) {
      this.bladeMat.transparent = fading;
      this.bladeMat.mrtNode = fading ? keepVelocityBehind() : null;
      this.bladeMat.needsUpdate = true;
    }
    this.bladeMat.opacity = w.mesh;
    this.bladeOpacity.value = w.mesh;
    this.blades.visible = w.mesh > 0.001;

    // Smear: N ghosts spread over the angle travelled during one frame, trailing the blade.
    const n = PROP_BLEND.ghosts;
    this.ghosts.visible = w.smear > 0.001;
    if (this.ghosts.visible) {
      const spread = omega * frameDt;
      for (let k = 0; k < n; k++) {
        const offset = -this.spinSign * spread * (k / (n - 1));
        this.tmp.makeRotationY(offset).multiply(this.meshMatrix);
        this.ghosts.setMatrixAt(k, this.tmp);
      }
      this.ghosts.instanceMatrix.needsUpdate = true;
    }
    this.ghostOpacity.value = w.smear / n;

    // Disc streak turns at the strobed rate. Disc φ = atan2(z, x) runs opposite to +Y rotation.
    const strobe = aliasedStep(this.spinSign * omega * frameDt, DRONE.bladeCount);
    this.blur.streakAngle.value = wrapAngle(this.blur.streakAngle.value - strobe * PROP_DISC.streakSlowdown);
    this.blur.update(w.disc);
  }
}
