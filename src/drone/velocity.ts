import { mrt, vec4 } from 'three/tsl';

/**
 * MRT override for translucent layers: velocity written with alpha 0, so blending keeps the
 * velocity of the surface behind. Without it, fast-spinning ghosts/discs stamp rotor motion
 * onto whatever they cover and TRAA reprojects that surface from the wrong place.
 */
export const keepVelocityBehind = () => mrt({ velocity: vec4(0, 0, 0, 0) });
