import {
  Box3,
  type BufferAttribute,
  Color,
  Group,
  Mesh,
  type Object3D,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DRONE, LEDS, PROP_BLEND, PROP_DISC } from '../config/drone';
import { Antenna } from './Antenna';
import { splitPayloadStraps } from './payloadStraps';
import { LEDs } from './LEDs';
import { Rotor } from './Rotor';
import { SpinArrows } from './SpinArrows';
import { Vibration } from './Vibration';

export type Vec3 = [number, number, number];

interface DroneExtras {
  mounts: { fpvCam: Vec3; hdCam: Vec3 };
  propDiameterM: number;
  bladeCount: number;
  credit: string;
  source: string;
}

function required<T extends Object3D>(root: Object3D, name: string): T {
  const o = root.getObjectByName(name);
  if (!o) throw new Error(`drone.glb: node "${name}" not found`);
  return o as T;
}

/** Average linear color of the prop blades, sampled from the baseColor texture at their UVs. */
function samplePropColor(rotor: Rotor): Color | null {
  const map = (rotor.blades.material as { map?: { image?: CanvasImageSource; transformUv(uv: Vector2): Vector2 } }).map;
  if (!map?.image) return null;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(map.image, 0, 0, S, S);
  const px = g.getImageData(0, 0, S, S).data;
  const uv = rotor.blades.geometry.getAttribute('uv');
  const idx = rotor.blades.geometry.getIndex();
  if (!uv || !idx) return null;
  const sum = new Color(0, 0, 0);
  const c = new Color();
  const t = new Vector2();
  let n = 0;
  for (let i = 0; i < idx.count; i += 3) {
    map.transformUv(t.fromBufferAttribute(uv as BufferAttribute, idx.getX(i)));
    const x = Math.min(S - 1, Math.max(0, Math.floor(t.x * S)));
    const y = Math.min(S - 1, Math.max(0, Math.floor(t.y * S)));
    const o = (y * S + x) * 4;
    c.setRGB(px[o] / 255, px[o + 1] / 255, px[o + 2] / 255, SRGBColorSpace);
    sum.r += c.r;
    sum.g += c.g;
    sum.b += c.b;
    n++;
  }
  return n ? sum.multiplyScalar(1 / n) : null;
}

/**
 * The drone rig (PRD §4.3). `root` is placed by the app; `body` (the asset's "drone" node)
 * carries vibration, so everything parented to it — rotors, antenna, payload, camera
 * mounts, LEDs — shakes together.
 */
export class DroneModel {
  readonly root = new Group();
  readonly body: Object3D;
  /** Betaflight order: rotors[0] is M1. */
  readonly rotors: Rotor[];
  readonly antenna: Antenna;
  /** The canister mesh from the asset. */
  readonly payload: Object3D;
  /** Canister + its mounting straps (moved out of `body` at load); toggled together. */
  readonly payloadParts: Object3D[];
  readonly mounts: { fpvCam: Object3D; hdCam: Object3D };
  readonly leds: LEDs;
  readonly arrows: SpinArrows;
  readonly extras: DroneExtras;
  /** Lift that puts the lowest visible part at the root's origin (m). */
  groundOffset = 0;
  onGroundOffsetChange: ((offset: number) => void) | null = null;

  private vibration: Vibration;
  private basePosition = new Vector3();
  private time = 0;
  private bodyAccel = new Vector3();

  static async load(url: string = DRONE.modelUrl): Promise<DroneModel> {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
    const body = gltf.scene.getObjectByName('drone');
    if (!body) throw new Error(`${url}: node "drone" not found`);
    return new DroneModel(body);
  }

  private constructor(body: Object3D) {
    this.root.name = 'drone_root';
    this.body = body;
    this.root.add(body);
    this.basePosition.copy(body.position);
    this.extras = body.userData as DroneExtras;

    body.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });

    this.rotors = DRONE.rotorNames.map((n) => new Rotor(required(body, n))).sort((a, b) => a.motorIndex - b.motorIndex);
    const color = samplePropColor(this.rotors[0]);
    for (const r of this.rotors) {
      if (color) r.setPropColor(color.r, color.g, color.b);
      else r.blur.color.value.setHex(PROP_DISC.fallbackColor);
    }

    this.antenna = new Antenna(required(body, 'antenna'));
    this.payload = required(body, 'payload');
    this.payloadParts = [this.payload];
    const bodyMesh = required<Mesh>(body, 'body');
    const payloadMesh = this.payload as Mesh;
    payloadMesh.updateMatrix();
    payloadMesh.geometry.computeBoundingBox();
    const payloadBox = payloadMesh.geometry.boundingBox!.clone().applyMatrix4(payloadMesh.matrix);
    const straps = splitPayloadStraps(bodyMesh, payloadBox, DRONE.payloadStrapBelowY);
    if (straps) {
      bodyMesh.geometry = straps.body;
      const strapMesh = new Mesh(straps.straps, bodyMesh.material);
      strapMesh.name = 'payload_straps';
      strapMesh.position.copy(bodyMesh.position);
      strapMesh.quaternion.copy(bodyMesh.quaternion);
      strapMesh.scale.copy(bodyMesh.scale);
      strapMesh.castShadow = strapMesh.receiveShadow = true;
      body.add(strapMesh);
      this.payloadParts.push(strapMesh);
    }

    const mount = (name: string, p: Vec3) => {
      const o = new Group();
      o.name = `mount_${name}`;
      o.position.set(...p);
      body.add(o);
      return o;
    };
    this.mounts = {
      fpvCam: mount('fpvCam', this.extras.mounts.fpvCam),
      hdCam: mount('hdCam', this.extras.mounts.hdCam),
    };

    this.leds = new LEDs({
      fc: new Vector3(...LEDS.fc.position),
      vtx: new Vector3(...LEDS.vtx.position),
      rearStripStart: new Vector3(...LEDS.rearStrip.position),
      rearStripDir: new Vector3(...LEDS.rearStrip.direction),
    });
    body.add(this.leds.group);

    this.arrows = new SpinArrows(this.rotors);
    body.add(this.arrows.group);

    this.vibration = new Vibration(this.rotors.length);
    this.updateGroundOffset();
  }

  /** Current frame vibration, 0..1 of the peak at rpmMax. */
  get vibrationIntensity(): number {
    return this.vibration.intensity;
  }

  setRpm(rpm: number | readonly number[]): void {
    this.rotors.forEach((r, i) => (r.rpm = typeof rpm === 'number' ? rpm : (rpm[i] ?? 0)));
  }

  setPayloadVisible(visible: boolean): void {
    for (const p of this.payloadParts) p.visible = visible;
    this.updateGroundOffset();
  }

  /** See Rotor.warmUp: compile the spinning-prop variants before the first frame. */
  warmUp(): void {
    for (const r of this.rotors) r.warmUp();
  }

  setSpinArrowsVisible(visible: boolean): void {
    this.arrows.group.visible = visible;
  }

  /** Recompute the lift from the visible parts' bounds in the rest pose. */
  updateGroundOffset(): void {
    const parts: Mesh[] = [];
    this.body.traverseVisible((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const isEffect = this.rotors.some((r) => m === r.blur.mesh || m === r.ghosts) || this.isOverlay(m);
      if (!isEffect) parts.push(m);
    });
    const savedPos = this.body.position.clone();
    const savedRot = this.body.rotation.clone();
    this.body.position.copy(this.basePosition);
    this.body.rotation.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    const box = new Box3();
    for (const m of parts) box.expandByObject(m);
    const rootY = this.root.getWorldPosition(new Vector3()).y;
    this.body.position.copy(savedPos);
    this.body.rotation.copy(savedRot);
    const offset = rootY - box.min.y;
    if (Math.abs(offset - this.groundOffset) > 1e-6) {
      this.groundOffset = offset;
      this.onGroundOffsetChange?.(offset);
    }
  }

  private isOverlay(o: Object3D): boolean {
    for (let p: Object3D | null = o; p; p = p.parent) if (p === this.arrows.group || p === this.leds.group) return true;
    return false;
  }

  /**
   * @param dt simulation step (s); 0 while frozen.
   * @param frameDt time one rendered frame represents (s); sizes the prop smear.
   */
  update(dt: number, frameDt: number = dt || PROP_BLEND.nominalFrameDtS): void {
    this.time += dt;
    for (const r of this.rotors) r.update(dt, frameDt);
    this.vibration.update(dt, this.rotors);
    this.body.position.copy(this.basePosition).add(this.vibration.position);
    this.body.rotation.copy(this.vibration.rotation);
    this.antenna.update(dt, this.vibration.intensity, this.bodyAccel);
    this.leds.update(this.time);
  }
}
