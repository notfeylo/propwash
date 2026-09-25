import { Color, DoubleSide, Mesh, MeshStandardNodeMaterial, RingGeometry } from 'three/webgpu';
import { atan, cos, float, hash, length, mix, positionLocal, screenCoordinate, smoothstep, uniform } from 'three/tsl';
import { DRONE, PROP_DISC } from '../config/drone';
import { keepVelocityBehind } from './velocity';

/**
 * High-RPM prop visual: a translucent disc on the rotor plane whose density follows the
 * blades' angular coverage and taper, with a faint streak turning at the strobed rate and a
 * sheen band from a roughness dip. Writes no depth; its shadow is dithered by its opacity.
 */
export class PropBlur {
  readonly mesh: Mesh;
  readonly weight = uniform(0);
  readonly streakAngle = uniform(0);
  readonly color = uniform(new Color(PROP_DISC.fallbackColor));

  constructor(name: string) {
    const cfg = PROP_DISC;
    const outer = DRONE.propRadiusM;
    const geo = new RingGeometry(cfg.innerRadiusM, outer, 128, 1).rotateX(-Math.PI / 2);

    const p = positionLocal.xz;
    const rn = length(p)
      .sub(cfg.innerRadiusM)
      .div(outer - cfg.innerRadiusM)
      .clamp(0, 1);
    const phi = atan(p.y, p.x);
    const radial = mix(float(cfg.hubDensity), float(cfg.tipDensity), rn)
      .mul(float(1).sub(smoothstep(float(1 - cfg.tipFade), float(1), rn)))
      .mul(smoothstep(float(0), float(cfg.innerFade), rn));
    const streak = cos(phi.sub(this.streakAngle).mul(DRONE.bladeCount))
      .mul(0.5)
      .add(0.5)
      .pow(cfg.streakSharpness)
      .mul(cfg.streakStrength);
    const alpha = this.weight.mul(cfg.coverage).mul(radial).mul(streak.add(1)).clamp(0, 1);
    const band = float(1).sub(smoothstep(float(0), float(cfg.sheenWidth), rn.sub(cfg.sheenCenter).abs()));

    const mat = new MeshStandardNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      envMapIntensity: cfg.envIntensity,
    });
    mat.colorNode = this.color.add(cfg.sheenLift);
    mat.opacityNode = alpha;
    mat.metalnessNode = float(0);
    mat.roughnessNode = mix(float(cfg.roughness), float(cfg.sheenRoughness), band);
    mat.mrtNode = keepVelocityBehind();
    mat.maskShadowNode = hash(screenCoordinate.x.add(screenCoordinate.y.mul(4099))).lessThan(alpha);

    this.mesh = new Mesh(geo, mat);
    this.mesh.name = name;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 2;
  }

  update(weight: number): void {
    this.weight.value = weight;
    this.mesh.visible = weight > 0.001;
  }
}
