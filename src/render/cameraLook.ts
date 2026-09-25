import { type Node, type TextureNode, Vector2 } from 'three/webgpu';
import {
  dot,
  float,
  Fn,
  fract,
  hash,
  mix,
  screenCoordinate,
  screenSize,
  screenUV,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { CAMERAS } from '../config/cameras';

// TSL's typings lose the vector type through arithmetic chains; use a loose node type here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** Per-frame values shared by every view's look (written by the CameraDirector). */
export class LookUniforms {
  /** Video area in screen UV (pillar/letterbox for 4:3 and 16:9 feeds). */
  readonly boxMin = uniform(new Vector2(0, 0));
  readonly boxSize = uniform(new Vector2(1, 1));
  readonly boxAspect = uniform(16 / 9);
  readonly barrelK = uniform(0);
  /** 0..1 dip to black during a camera cut. */
  readonly fade = uniform(0);
  /** Signed whip-pan amount during a cut (0 = none). */
  readonly whip = uniform(0);
  /** 1 = no video (drone unpowered): analog snow / digital black. */
  readonly noSignal = uniform(0);
  /** Link quality 0..1 (analog breakup); 1 until the RSSI model lands. */
  readonly signal = uniform(1);
  /** Rolling-shutter jello amount × current frame vibration (HD). */
  readonly jello = uniform(0);
}

export type LookKind = 'orbit' | 'analog' | 'digital' | 'hd';

/**
 * Final camera stage, in display space (after tone mapping): barrel distortion into the feed's
 * video box, then the feed's character. Analog: chroma bleed, softness, grain, scanlines,
 * vignette, snow when there's no signal. Digital/HD: mild sharpening, clean vignette.
 *
 * The scene is rendered full screen, framed so the video box spans the lens's field of view.
 * The barrel maps box → source and is normalized on the diagonal, so the frame fills edge to
 * edge: the centre is magnified and straight lines bow like a fisheye.
 */
export function cameraLook(src: TextureNode, u: LookUniforms, kind: LookKind): Node {
  const A = CAMERAS.analog;
  const D = CAMERAS.digital;
  const H = CAMERAS.hd;
  const texel: N = vec2(1).div(screenSize);

  return Fn(() => {
    const b: N = screenUV.sub(u.boxMin).div(u.boxSize);
    const inside: N = step(0, b.x).mul(step(b.x, 1)).mul(step(0, b.y)).mul(step(b.y, 1));

    const q: N = b.sub(0.5).mul(vec2(u.boxAspect, 1)).toVar();
    const corner: N = u.boxAspect.mul(u.boxAspect).add(1).mul(0.25);
    const s: N = float(1)
      .add(u.barrelK.mul(dot(q, q)))
      .div(float(1).add(u.barrelK.mul(corner)));
    const qs: N = q.mul(s).toVar();
    if (kind === 'hd') qs.x.addAssign(u.jello.mul(sin(b.y.mul(H.jello.bands * 6.2832).add(time.mul(37)))));
    qs.x.addAssign(u.whip.mul(u.boxAspect)); // whip-pan: slide sideways during a cut
    const uv: N = qs.div(vec2(u.boxAspect, 1)).add(0.5).mul(u.boxSize).add(u.boxMin);

    const tap = (o: N): N => src.sample(uv.add(o)).rgb;
    let col: N;
    if (kind === 'analog') {
      const shift = vec2(A.chromaShift, 0);
      const soft: N = texel.mul(A.blurPx);
      const r = src.sample(uv.add(shift)).r;
      const g = src.sample(uv).g;
      const bl = src.sample(uv.sub(shift)).b;
      const blur: N = tap(vec2(soft.x, 0))
        .add(tap(vec2(soft.x.negate(), 0)))
        .add(tap(vec2(0, soft.y)))
        .add(tap(vec2(0, soft.y.negate())))
        .mul(0.25);
      col = mix(vec3(r, g, bl), blur, A.softness);
    } else if (kind === 'orbit') {
      col = tap(vec2(0, 0));
    } else {
      const c: N = tap(vec2(0, 0));
      const n: N = tap(vec2(texel.x, 0))
        .add(tap(vec2(texel.x.negate(), 0)))
        .add(tap(vec2(0, texel.y)))
        .add(tap(vec2(0, texel.y.negate())))
        .mul(0.25);
      col = c.add(c.sub(n).mul(kind === 'hd' ? H.sharpen : D.sharpen));
    }

    const vig = kind === 'analog' ? A.vignette : kind === 'hd' ? H.vignette : kind === 'digital' ? D.vignette : 0;
    if (vig > 0) {
      const rn: N = dot(q, q).div(corner);
      col = col.mul(float(1).sub(smoothstep(0.25, 1.0, rn).mul(vig)));
    }

    if (kind === 'analog') {
      const seed: N = screenCoordinate.x.add(screenCoordinate.y.mul(4099)).add(fract(time.mul(0.37)).mul(1e5));
      const grain: N = hash(seed).sub(0.5).mul(A.noise);
      const lines: N = float(1).sub(
        sin(b.y.mul(A.scanlines.lines * 3.1416))
          .mul(0.5)
          .add(0.5)
          .mul(A.scanlines.depth),
      );
      col = col.mul(lines).add(grain);
      // Snow when there's no video; heavier breakup as the link degrades.
      const snowSeed: N = screenCoordinate.x
        .div(2)
        .floor()
        .add(screenCoordinate.y.div(2).floor().mul(977))
        .add(fract(time.mul(0.61)).mul(1e5));
      const snow: N = vec3(hash(snowSeed).mul(A.breakup.snow));
      col = mix(col, snow, u.noSignal.max(float(1).sub(u.signal).mul(0.5)));
    } else if (kind !== 'orbit') {
      col = col.mul(float(1).sub(u.noSignal));
    }

    col = col.mul(kind === 'orbit' ? 1 : inside).mul(float(1).sub(u.fade));
    return vec4(col, 1);
  })() as Node;
}
