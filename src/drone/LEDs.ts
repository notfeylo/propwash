import { Color, Group, Mesh, MeshStandardNodeMaterial, SphereGeometry, Vector3 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { LEDS } from '../config/drone';

export type FcLedMode = 'off' | 'solid' | 'blink';
export type VtxLedMode = 'off' | 'red' | 'green';

function led(radius: number, color: number) {
  const on = uniform(0);
  const tint = uniform(new Color(color));
  const mat = new MeshStandardNodeMaterial({ color: 0x0a0a0a, roughness: 0.3, metalness: 0 });
  mat.emissiveNode = tint.mul(on).mul(LEDS.intensity);
  const mesh = new Mesh(new SphereGeometry(radius, 12, 8), mat);
  mesh.castShadow = false;
  return { mesh, on, tint };
}

/**
 * Small emissive parts added to the model (not in the source asset): FC status LED,
 * VTX LED, and an optional rear strip. Intensities sit above the bloom threshold.
 */
export class LEDs {
  readonly group = new Group();
  fcMode: FcLedMode = 'off';
  vtxMode: VtxLedMode = 'off';
  rearStrip: boolean = LEDS.rearStrip.enabledByDefault;
  private fc = led(LEDS.fc.radiusM, LEDS.fc.color);
  private vtx = led(LEDS.vtx.radiusM, LEDS.vtx.colors.red);
  private strip: ReturnType<typeof led>[] = [];

  constructor(positions: { fc: Vector3; vtx: Vector3; rearStripStart: Vector3; rearStripDir: Vector3 }) {
    this.group.name = 'leds';
    this.fc.mesh.position.copy(positions.fc);
    this.vtx.mesh.position.copy(positions.vtx);
    this.group.add(this.fc.mesh, this.vtx.mesh);
    const { count, spacingM, radiusM, color } = LEDS.rearStrip;
    for (let i = 0; i < count; i++) {
      const l = led(radiusM, color);
      l.mesh.position
        .copy(positions.rearStripStart)
        .addScaledVector(positions.rearStripDir, (i - (count - 1) / 2) * spacingM);
      this.strip.push(l);
      this.group.add(l.mesh);
    }
  }

  setFc(mode: FcLedMode): void {
    this.fcMode = mode;
  }

  setVtx(mode: VtxLedMode): void {
    this.vtxMode = mode;
    if (mode !== 'off') this.vtx.tint.value.setHex(LEDS.vtx.colors[mode]);
  }

  setRearStrip(on: boolean): void {
    this.rearStrip = on;
  }

  update(timeS: number): void {
    const blinkOn = Math.floor(timeS * LEDS.fc.blinkHz * 2) % 2 === 0;
    this.fc.on.value = this.fcMode === 'solid' || (this.fcMode === 'blink' && blinkOn) ? 1 : 0;
    this.vtx.on.value = this.vtxMode === 'off' ? 0 : 1;
    for (const l of this.strip) {
      l.on.value = this.rearStrip ? 1 : 0;
      l.mesh.visible = this.rearStrip;
    }
  }
}
