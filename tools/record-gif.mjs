/* global window */
// tools/record-gif.mjs — `pnpm record:gif [baseUrl]`
// Renders the README GIF (PRD §4.9): plug → arm → throttle sweep → FPV → disarm, 20 s.
// The sim clock is frozen and stepped exactly one GIF frame per capture, so the result is smooth
// however slowly frames are captured. Needs a running server, ffmpeg (FFMPEG_PATH) and, for
// real WebGPU, CHANNEL=chrome.
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = path.join(ROOT, 'docs/media/propwash.gif');
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FPS = 15;
const SECONDS = 20;
const W = 1280;
const H = 720;
const GIF_W = 600;
const GIF_FPS = 12;
const COLORS = 96;

// FRAMES=<dir> keeps the captured frames there and reuses them when present (to retune the encode).
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
  await page.goto(`${BASE}/?quality=ultra&dynres=0`);
  await page.waitForFunction(() => window.__propwash?.ready === true, undefined, { timeout: 60_000 });
  await page.addStyleTag({ content: '.pw-audio, .pw-keys, .pw-input { display: none !important; }' });
  await page.evaluate(() => {
    const p = window.__propwash;
    p.freeze(true);
    p.setWhipPan(false);
  });

  const d = (fn, arg) => page.evaluate(fn, arg);
  const smooth = (x) => x * x * (3 - 2 * x);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const ramp = (t, t0, t1) => smooth(clamp01((t - t0) / (t1 - t0)));

  /** Throttle over the clip: sweep 0 → 100 → 0 in orbit, hover-ish in FPV/HD, a blip, then disarm. */
  function throttleAt(t) {
    if (t < 3.6) return 0;
    if (t < 5.6) return ramp(t, 3.6, 5.6);
    if (t < 7.6) return 1 - ramp(t, 5.6, 7.6);
    if (t < 14.8) return 0.34 + 0.12 * Math.sin((t - 7.6) * 1.3) * ramp(t, 7.6, 8.6);
    if (t < 15.6) return 0.34 + 0.46 * ramp(t, 14.8, 15.3);
    return 0.8;
  }
  // Timeline: [time, action]
  const events = [
    [1.0, 'plug'],
    [2.8, 'arm'],
    [8.2, 'fpv'],
    [10.8, 'digital'],
    [12.6, 'hd'],
    [14.6, 'orbit'],
    [16.6, 'disarm'],
  ];

  const frames = FPS * SECONDS;
  for (let f = 0; f < frames; f++) {
    const t = f / FPS;
    for (const [at, what] of events) {
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
    // The orbit camera holds still: a moving view changes every floor pixel and bloats the GIF.
    const a = 0.78;
    const r = 0.66;
    await d(
      ({ a, r, y, thr }) => {
        const p = window.__propwash;
        if (p.camera().mode === 'orbit') p.setView([Math.sin(a) * r, y, Math.cos(a) * r]);
        p.setThrottle(thr);
        p.step(1 / 15);
      },
      { a, r, y: 0.27, thr: throttleAt(t) },
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
const scale = `fps=${GIF_FPS},scale=${GIF_W}:-1:flags=lanczos`;
run(['-y', ...input, '-vf', `${scale},palettegen=max_colors=${COLORS}:stats_mode=diff`, path.join(tmp, 'palette.png')]);
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
