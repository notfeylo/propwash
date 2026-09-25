import {
  CanvasTexture,
  CatmullRomCurve3,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  Quaternion,
  Sprite,
  SpriteNodeMaterial,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
} from 'three/webgpu';
import { SPIN_ARROWS } from '../config/drone';
import type { Rotor } from './Rotor';

function label(text: string, color: string): Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  g.fillStyle = 'rgba(8,10,12,0.72)';
  g.beginPath();
  g.roundRect(4, 4, 248, 88, 18);
  g.fill();
  g.fillStyle = color;
  g.font = 'bold 54px ui-monospace, Menlo, Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 50);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const s = new Sprite(new SpriteNodeMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(0.05, 0.019, 1);
  s.renderOrder = 10;
  return s;
}

/**
 * Debug overlay: a curved arrow over each rotor showing its commanded spin direction
 * (from the asset extras) plus a "M1 CW" label. The arrow is built from the same sign
 * convention the rotor integrates with, so arrow and spinning prop must agree.
 */
export class SpinArrows {
  readonly group = new Group();

  constructor(rotors: readonly Rotor[]) {
    this.group.name = 'spin_arrows';
    this.group.visible = false;
    const { radiusM: r, tubeM, arcRad, heightAboveRotorM, colors } = SPIN_ARROWS;
    for (const rotor of rotors) {
      const s = rotor.spinSign;
      // Rotating by +θ about +Y carries (r, 0, 0) to (r cos θ, 0, −r sin θ).
      const at = (phi: number) => new Vector3(r * Math.cos(phi), 0, -s * r * Math.sin(phi));
      const pts = Array.from({ length: 33 }, (_, i) => at((i / 32) * arcRad));
      const color = colors[rotor.spin];
      const mat = new MeshBasicNodeMaterial({ color, depthTest: false, transparent: true });
      const arrow = new Group();
      const tube = new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 64, tubeM, 8, false), mat);
      const head = new Mesh(new ConeGeometry(tubeM * 3.2, tubeM * 8, 12), mat);
      const tangent = new Vector3(-r * Math.sin(arcRad), 0, -s * r * Math.cos(arcRad)).normalize();
      head.position.copy(at(arcRad));
      head.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), tangent));
      arrow.add(tube, head);
      const tag = label(`M${rotor.motorIndex} ${rotor.spin}`, `#${color.toString(16).padStart(6, '0')}`);
      tag.position.set(0, 0.012, 0);
      arrow.add(tag);
      arrow.position.copy(rotor.pivot.position).add(new Vector3(0, rotor.bladePlaneY + heightAboveRotorM, 0));
      for (const m of [tube, head]) m.renderOrder = 9;
      this.group.add(arrow);
    }
  }
}
