import { Object3D, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { ANTENNA, DRONE, VIBRATION } from '../../src/config/drone';
import { Antenna } from '../../src/drone/Antenna';
import type { Rotor } from '../../src/drone/Rotor';
import { Vibration } from '../../src/drone/Vibration';

const rotors = (rpm: number) => Array.from({ length: 4 }, (_, i) => ({ rpm, angle: i * 1.1 }) as unknown as Rotor);

describe('Vibration', () => {
  it('is exactly zero with motors stopped', () => {
    const v = new Vibration(4);
    v.update(1 / 60, rotors(0));
    expect(v.position.length()).toBe(0);
    expect(v.intensity).toBe(0);
  });

  it('never exceeds the PRD amplitude at max RPM', () => {
    const v = new Vibration(4);
    for (let i = 0; i < 2000; i++) {
      const rs = rotors(DRONE.rpmMax).map((r, k) => ({ ...r, angle: i * 0.37 + k }) as unknown as Rotor);
      v.update(1 / 60, rs);
      for (const c of v.position.toArray()) expect(Math.abs(c)).toBeLessThanOrEqual(VIBRATION.positionM + 1e-12);
      for (const c of [v.rotation.x, v.rotation.y, v.rotation.z])
        expect(Math.abs(c)).toBeLessThanOrEqual(VIBRATION.rotationRad + 1e-12);
    }
  });

  it('scales with (rpm/rpmMax)²', () => {
    const v = new Vibration(4);
    v.update(0, rotors(DRONE.rpmMax / 2));
    expect(v.intensity).toBeCloseTo(0.25);
  });
});

describe('Antenna', () => {
  it('rings down after a push and stays within limits', () => {
    const a = new Antenna(new Object3D());
    a.velocity.set(1, -1);
    for (let i = 0; i < 60 * 20; i++) a.update(1 / 60, 0, new Vector3());
    expect(Math.abs(a.angle.x)).toBeLessThan(1e-3);
    expect(Math.abs(a.angle.y)).toBeLessThan(1e-3);
  });

  it('settles to the static deflection k·θ = drive under constant acceleration', () => {
    const a = new Antenna(new Object3D());
    const accel = new Vector3(0, 0, -2);
    for (let i = 0; i < 60 * 30; i++) a.update(1 / 60, 0, accel);
    expect(a.angle.x).toBeCloseTo((2 * ANTENNA.accelDrive) / ANTENNA.stiffness, 4);
  });

  it('is stable at a long frame step', () => {
    const a = new Antenna(new Object3D());
    for (let i = 0; i < 100; i++) a.update(0.1, 1, new Vector3());
    expect(Number.isFinite(a.angle.x)).toBe(true);
    expect(Math.abs(a.angle.x)).toBeLessThanOrEqual(ANTENNA.maxAngleRad);
  });
});
