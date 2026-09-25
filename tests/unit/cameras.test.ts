import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector2 } from 'three/webgpu';
import { CameraDirector } from '../../src/cameras/CameraDirector';
import { CAMERAS } from '../../src/config/cameras';
import type { LookUniforms } from '../../src/render/cameraLook';
import { mmss } from '../../src/ui/OSD';

const v = <T>(value: T) => ({ value });
function director() {
  const look = {
    boxMin: v(new Vector2()),
    boxSize: v(new Vector2(1, 1)),
    boxAspect: v(1),
    barrelK: v(0),
    fade: v(0),
    whip: v(0),
    noSignal: v(0),
    signal: v(1),
    jello: v(0),
  } as unknown as LookUniforms;
  const views: string[] = [];
  const d = new CameraDirector(new PerspectiveCamera(), { enabled: true } as never, look, (k) => views.push(k));
  d.resize(1280, 720);
  return { d, look, views };
}
const frame = { fpvSignal: true, vibration: 0 };

describe('CameraDirector', () => {
  it('cycles Orbit → FPV → HD → Orbit through a dip to black', () => {
    const { d, look, views } = director();
    d.cycle();
    expect(d.mode).toBe('orbit'); // the cut switches at its midpoint
    d.update(CAMERAS.cut.durationS * 0.5 + 1e-3, frame);
    expect(d.mode).toBe('fpv');
    expect(look.fade.value).toBeGreaterThan(0.9);
    d.update(CAMERAS.cut.durationS, frame);
    expect(look.fade.value).toBe(0);
    d.setMode('hd', true);
    d.cycle();
    d.update(1, frame);
    expect(d.mode).toBe('orbit');
    expect(views).toEqual(['analog', 'hd', 'orbit']);
  });

  it('pillarboxes the 4:3 analog feed and fills the screen with 16:9', () => {
    const { d, look } = director();
    d.setMode('fpv', true);
    expect(d.videoBox).toEqual({ x: 160, y: 0, width: 960, height: 720 });
    expect(look.boxAspect.value).toBeCloseTo(4 / 3);
    d.setFeed('digital');
    expect(d.videoBox).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it('frames the video box at the lens FOV; the render camera keeps the screen aspect', () => {
    const { d } = director();
    d.setMode('fpv', true);
    d.setFeed('digital');
    const r = d.renderCamera;
    expect(r.aspect).toBeCloseTo(16 / 9);
    const hfov = 2 * Math.atan(Math.tan((r.fov * Math.PI) / 360) * r.aspect);
    expect((hfov * 180) / Math.PI).toBeCloseTo(CAMERAS.fpv.hfovDeg, 5);
  });

  it('clamps uptilt to 0–50° and signals NO SIGNAL only in FPV', () => {
    const { d, look } = director();
    d.setUptilt(80);
    expect(d.uptiltDeg).toBe(50);
    d.setUptilt(-5);
    expect(d.uptiltDeg).toBe(0);
    d.update(0.016, { fpvSignal: false, vibration: 0 });
    expect(look.noSignal.value).toBe(0);
    d.setMode('fpv', true);
    d.update(0.016, { fpvSignal: false, vibration: 0 });
    expect(look.noSignal.value).toBe(1);
    d.setMode('hd', true);
    d.update(0.016, { fpvSignal: false, vibration: 0 });
    expect(look.noSignal.value).toBe(0);
  });
});

describe('OSD', () => {
  it('formats timers as mm:ss', () => {
    expect(mmss(0)).toBe('00:00');
    expect(mmss(75.9)).toBe('01:15');
  });
});
