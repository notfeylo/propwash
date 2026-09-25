// Drone asset facts (PRD §2.1, §4.1). Values measured from the source model.
export const DRONE = {
  modelUrl: '/models/drone.glb',
  rotorNames: ['rotor_RR', 'rotor_FR', 'rotor_RL', 'rotor_FL'] as const,
  propRadiusM: 0.0889,
} as const;
