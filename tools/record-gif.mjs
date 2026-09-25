/* global window */
// tools/record-gif.mjs — `pnpm record:gif [baseUrl] [scenario]`
// Renders a GIF of a scripted session. Scenarios:
//   bench   (default) Phase 1 README GIF: plug → arm → throttle sweep → FPV → disarm, 20 s, bench model.
//   liftoff Phase 2 group 1: arm and lift off the pad open loop (no flight controller), calm air.
// The sim clock is frozen and stepped exactly one GIF frame per capture, so the result is smooth
// however slowly frames are captured. Needs a running server, ffmpeg (FFMPEG_PATH) and, for
// real WebGPU, CHANNEL=chrome. FRAMES=<dir> keeps the frames and reuses them to retune the encode.
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] ?? 'http://localhost:5173';
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FPS = 15;
const W = 1280;
const H = 720;

const smooth = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ramp = (t, t0, t1) => smooth(clamp01((t - t0) / (t1 - t0)));

const SCENARIOS = {
  bench: {
    out: 'docs/media/propwash.gif',
    seconds: 20,
    // The Phase 1 bench: props spool on the pad, nothing flies.
    query: '?quality=ultra&dynres=0&flight=0',
    gif: { width: 600, fps: 12, colors: 96 },
    hide: '.pw-audio, .pw-keys, .pw-input',
    async setup() {},
    /** Throttle: sweep 0 → 100 → 0 in orbit, hover-ish in FPV/HD, a blip, then disarm. */
    throttleAt(t) {
      if (t < 3.6) return 0;
      if (t < 5.6) return ramp(t, 3.6, 5.6);
      if (t < 7.6) return 1 - ramp(t, 5.6, 7.6);
      if (t < 14.8) return 0.34 + 0.12 * Math.sin((t - 7.6) * 1.3) * ramp(t, 7.6, 8.6);
      if (t < 15.6) return 0.34 + 0.46 * ramp(t, 14.8, 15.3);
      return 0.8;
    },
    events: [
      [1.0, 'plug'],
      [2.8, 'arm'],
      [8.2, 'fpv'],
      [10.8, 'digital'],
      [12.6, 'hd'],
      [14.6, 'orbit'],
      [16.6, 'disarm'],
    ],
    // The orbit camera holds still: a moving view changes every floor pixel and bloats the GIF.
    view: () => ({ position: [Math.sin(0.78) * 0.66, 0.27, Math.cos(0.78) * 0.66] }),
  },
  liftoff: {
    out: 'docs/media/phase2-liftoff.gif',
    seconds: 9,
    query: '?quality=ultra&dynres=0&wind=calm',
    gif: { width: 640, fps: 15, colors: 128 },
    hide: '.pw-audio, .pw-keys, .pw-input',
    async setup(page) {
      await page.waitForFunction(() => window.__propwash.flight() !== null, undefined, { timeout: 60_000 });
      await page.evaluate(() => {
        window.__propwash.setFollow(false);
        window.__propwash.plug();
      });
      await page.waitForFunction(() => window.__propwash.power().state === 'DISARMED', undefined, { timeout: 20_000 });
    },
    /** Spool, lift off, ease back to hover (open loop: the pilot's throttle is all there is). */
    throttleAt(t) {
      if (t < 1.2) return 0;
      if (t < 2.6) return 0.48 * ramp(t, 1.2, 1.8);
      if (t < 3.6) return 0.48 - 0.1 * ramp(t, 2.6, 3.1);
      return 0.38 + 0.045 * ramp(t, 3.6, 4.4);
    },
    events: [[0.5, 'arm']],
    view: () => ({ position: [1.05, 0.85, 1.55], target: [0, 1.05, 0], fov: 62 }),
  },
};

const name = process.argv[3] ?? 'bench';
const S = SCENARIOS[name];
if (!S) throw new Error(`unknown scenario "${name}" (${Object.keys(SCENARIOS).join(', ')})`);
const OUT = path.join(ROOT, S.out);

const tmp = process.env.FRAMES ?? mkdtempSync(path.join(os.tmpdir(), 'propwash-gif-'));
mkdirSync(tmp, { recursive: true });
mkdirSync(path.dirname(OUT), { recursive: true });
const reuse = !!process.env.FRAMES && existsSync(path.join(tmp, 'f0000.png'));

if (!reuse) {
  const browser = await chromium.launch({
    channel: process.env.CHANNEL || undefined,
    args: ['--enable-unsafe-webgpu'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${BASE}/${S.query}`);
  await page.waitForFunction(() => window.__propwash?.ready === true, undefined, { timeout: 60_000 });
  await page.addStyleTag({ content: `${S.hide} { display: none !important; }` });
  await S.setup(page);
  await page.evaluate(() => {
    const p = window.__propwash;
    p.freeze(true);
    p.setWhipPan(false);
  });
  const d = (fn, arg) => page.evaluate(fn, arg);

  const frames = FPS * S.seconds;
  for (let f = 0; f < frames; f++) {
    const t = f / FPS;
    for (const [at, what] of S.events) {
      if (at <= t && at > t - 1 / FPS) {
        await d((w) => {
          const p = window.__propwash;
          if (w === 'plug') p.plug();
          else if (w === 'arm') p.arm();
          else if (w === 'disarm') p.disarm();
          else if (w === 'digital') p.setFeed('digital');
          else if (w === 'fpv') {
            p.setFeed('analog');
            p.setCamera('fpv');
          } else p.setCamera(w);
        }, what);
      }
    }
    await d(
      ({ view, thr }) => {
        const p = window.__propwash;
        if (p.camera().mode === 'orbit') p.setView(view.position, view.target, view.fov);
        p.setThrottle(thr);
        p.step(1 / 15);
      },
      { view: S.view(t), thr: S.throttleAt(t) },
    );
    await page.waitForTimeout(90); // step lands on the next frame; let TRAA settle a little
    await page.screenshot({ path: path.join(tmp, `f${String(f).padStart(4, '0')}.png`) });
    if (f % 30 === 0) process.stdout.write(`frame ${f}/${frames}\r`);
  }
  await browser.close();
  if (errors.length) console.error('console errors:\n' + errors.join('\n'));
}

const run = (args) => {
  const r = spawnSync(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.toString().slice(-800)}`);
};
const input = ['-framerate', String(FPS), '-i', path.join(tmp, 'f%04d.png')];
const scale = `fps=${S.gif.fps},scale=${S.gif.width}:-1:flags=lanczos`;
run([
  '-y',
  ...input,
  '-vf',
  `${scale},palettegen=max_colors=${S.gif.colors}:stats_mode=diff`,
  path.join(tmp, 'palette.png'),
]);
run([
  '-y',
  ...input,
  '-i',
  path.join(tmp, 'palette.png'),
  '-lavfi',
  `${scale}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`,
  '-loop',
  '0',
  OUT,
]);
if (!process.env.FRAMES) rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${path.relative(ROOT, OUT)} (${(statSync(OUT).size / 1e6).toFixed(2)} MB)`);
