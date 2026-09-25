import { describe, expect, it } from 'vitest';
import { DRONE } from '../../src/config/drone';

describe('drone config', () => {
  it('lists the four rotors in Betaflight motor order', () => {
    expect(DRONE.rotorNames).toEqual(['rotor_RR', 'rotor_FR', 'rotor_RL', 'rotor_FL']);
  });

  it('uses a 7-inch prop radius', () => {
    expect(DRONE.propRadiusM * 2).toBeCloseTo(0.1778, 4);
  });
});
