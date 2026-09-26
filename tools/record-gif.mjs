/* global window, requestAnimationFrame */
// tools/record-gif.mjs — `pnpm record:gif [baseUrl] [scenario]`
// Renders a GIF of a scripted session. Scenarios:
//   bench   (default) Phase 1 README GIF: plug → arm → throttle sweep → FPV → disarm, 20 s, bench model.
//   liftoff Phase 2 group 1: arm and lift off the pad open loop (no flight controller), calm air.
//   field   Phase 2 group 3: the test field. Take off and fly low with a flip, land on the pad,
//           then a turtle flip on the grass and a hop. A scripted pilot closes the loop on the sim.
//   flip    Phase 2 group 2: FPV (digital feed), Horizon mode: climb, roll flip, front flip, all through
//           the flight controller (full stick flips; centred sticks self-level).
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

SCENARIOS.flip = {
  out: 'docs/media/phase2-flip-fpv.gif',
  seconds: 9,
  query: '?quality=ultra&dynres=0&wind=calm&airframe=freestyle7&cam=fpv&feed=digital',
  gif: { width: 640, fps: 15, colors: 128 },
  hide: '.pw-audio, .pw-keys, .pw-input, .pw-hud, .pw-hud-tools',
  async setup(page) {
    await page.waitForFunction(() => window.__propwash.flight() !== null, undefined, { timeout: 60_000 });
    await page.evaluate(() => {
      window.__propwash.setFlightMode('horizon');
      window.__propwash.plug();
    });
    await page.waitForFunction(() => window.__propwash.power().state === 'DISARMED', undefined, { timeout: 20_000 });
  },
  /** Low over the pad: climb, then pop up and flip with the throttle eased off, like a pilot does. */
  throttleAt(t) {
    const steps = [
      [0.8, 0],
      [1.25, null],
      [1.8, 0.2],
      [2.9, 0.262],
      [3.15, 0.45],
      [3.75, 0.15],
      [4.3, 0.32],
      [5.45, 0.266],
      [5.7, 0.45],
      [6.25, 0.15],
      [6.8, 0.32],
      [Infinity, 0.262],
    ];
    for (const [end, v] of steps) if (t < end) return v ?? 0.4 * ramp(t, 0.8, 0.95);
    return 0.262;
  },
  sticksAt(t) {
    const roll = t >= 3.2 && t < 3.2 + 8 / 15 ? 1 : 0;
    const pitch = t >= 5.7 && t < 5.7 + 8 / 15 ? 1 : 0;
    return { roll, pitch, yaw: 0 };
  },
  events: [[0.3, 'arm']],
  view: () => ({ position: [0.42, 0.26, 0.5] }),
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
SCENARIOS.field = {
  out: 'docs/media/phase2-field.gif',
  seconds: 17,
  query: '?quality=ultra&dynres=0&airframe=freestyle7',
  gif: { width: 560, fps: 12, colors: 96 },
  hide: '.pw-audio, .pw-keys, .pw-input, .pw-hud-tools',
  /** Control sub-steps per GIF frame (the scripted pilot runs at 45 Hz). */
  substeps: 3,
  async setup(page) {
    await page.waitForFunction(() => window.__propwash.flight() !== null, undefined, { timeout: 60_000 });
    await page.evaluate(() => {
      const p = window.__propwash;
      p.setFlightMode('horizon');
      p.setFollow(false);
      p.plug();
    });
    await page.waitForFunction(() => window.__propwash.power().state === 'DISARMED', undefined, { timeout: 20_000 });
  },
  /**
   * The pilot: altitude and descent holds on the throttle, stick inputs by time.
   * @param t seconds · @param f flight state · @param pw power state · @param mem scratch memory
   */
  control(t, f, pw, mem) {
    const y = f.position[1];
    const vy = f.velocity[1];
    const out = { throttle: 0, sticks: { roll: 0, pitch: 0, yaw: 0 }, actions: [] };
    const once = (key, action) => {
      if (!mem[key]) {
        mem[key] = true;
        out.actions.push(action);
      }
    };
    if (t < 6.4) {
      // A: take off, hold ~3 m, fly forward low over the grass, roll flip at 4 s.
      once('armA', 'arm');
      const hold = 0.27 + clamp(0.09 * (3 - y) - 0.08 * vy, -0.12, 0.2);
      out.throttle = t < 0.5 ? 0 : hold / Math.cos(Math.min(0.5, f.tiltDeg * (Math.PI / 180)));
      if (t > 1.6) out.sticks.pitch = 0.3;
      if (t >= 4 && t < 4 + 8 / 15) {
        out.sticks = { roll: 1, pitch: 0, yaw: 0 };
        out.throttle = 0.2;
      }
    } else if (t < 11) {
      // B: back over the pad at 2.5 m, descend at 1 m/s, throttle off on contact, disarm.
      once('placeB', 'place:0,0,2.5,0');
      if (!mem.touch) out.throttle = clamp(0.263 + 0.25 * (-1 - vy), 0.05, 0.6);
      if (f.onGround && !mem.touch) mem.touch = t;
      if (mem.touch && t > mem.touch + 0.4) once('disarmB', 'disarm');
    } else {
      // C: upside down on the grass: turtle flips it, then re-arm and hop.
      once('placeC', 'place:3,2.5,0.3,180');
      if (t > 12) once('turtle', 'turtle');
      if (t > 12.2) once('armTurtle', 'arm');
      if (pw.state !== 'OFF' && t > 12.4 && !mem.upright) {
        out.sticks.roll = 0.8;
        if (f.tiltDeg < 35 && f.onGround) mem.upright = t;
      }
      if (mem.upright && t > mem.upright + 0.9) once('rearm', 'arm');
      if (mem.upright && t > mem.upright + 1.1) out.throttle = clamp(0.263 + 0.12 * (0.9 - y) - 0.12 * vy, 0.15, 0.4);
    }
    return out;
  },
  view(t, f) {
    const [x, y, z] = f ? f.position : [0, 0, 0];
    if (t < 6.4) return { position: [x + 1.6, y + 0.9, z + 2.6], target: [x, y + 0.1, z - 1], fov: 55 };
    if (t < 11) return { position: [2.2, 1.4, 3.2], target: [0, 0.8, 0], fov: 50 };
    return { position: [4.6, 0.9, 4.4], target: [3, 0.25, 2.5], fov: 50 };
  },
  events: [],
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
  const mem = {};
  for (let f = 0; f < frames; f++) {
    const t = f / FPS;
    if (S.control) {
      // Closed loop: read the sim, let the scripted pilot decide, step, repeat.
      for (let k = 0; k < S.substeps; k++) {
        const tk = t + k / (FPS * S.substeps);
        const st = await d(() => ({ f: window.__propwash.flight(), pw: window.__propwash.power() }));
        const c = S.control(tk, st.f, st.pw, mem);
        await d(
          async ({ c, view, dt }) => {
            const p = window.__propwash;
            for (const a of c.actions) {
              if (a === 'arm') p.arm();
              else if (a === 'disarm') p.disarm();
              else if (a === 'turtle') p.setTurtle(true);
              else if (a.startsWith('place:')) {
                const [x, z, alt, roll] = a.slice(6).split(',').map(Number);
                p.placeDrone(x, z, alt, roll);
              }
            }
            p.setView(view.position, view.target, view.fov);
            p.setThrottle(c.throttle);
            p.setSticks(c.sticks);
            p.step(dt);
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          },
          { c, view: S.view(tk, st.f), dt: 1 / (FPS * S.substeps) },
        );
      }
      if (process.env.DRY) {
        // Dry run: log the flight instead of capturing (to tune a scenario).
        if (f % 5 === 0) {
          const st = await d(() => ({ f: window.__propwash.flight(), pw: window.__propwash.power() }));
          console.log(
            `${t.toFixed(2)} ${st.pw.state} pos ${st.f.position.map((v) => v.toFixed(2)).join(',')} vy ${st.f.velocity[1].toFixed(2)} tilt ${st.f.tiltDeg.toFixed(0)} ground ${st.f.onGround} turtle ${st.f.turtle}`,
          );
        }
        continue;
      }
      await page.waitForTimeout(60);
      await page.screenshot({ path: path.join(tmp, `f${String(f).padStart(4, '0')}.png`) });
      if (f % 30 === 0) process.stdout.write(`frame ${f}/${frames}\r`);
      continue;
    }
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
      ({ view, thr, sticks }) => {
        const p = window.__propwash;
        if (p.camera().mode === 'orbit') p.setView(view.position, view.target, view.fov);
        p.setThrottle(thr);
        if (sticks) p.setSticks(sticks);
        p.step(1 / 15);
      },
      { view: S.view(t), thr: S.throttleAt(t), sticks: S.sticksAt ? S.sticksAt(t) : null },
    );
    await page.waitForTimeout(90); // step lands on the next frame; let TRAA settle a little
    await page.screenshot({ path: path.join(tmp, `f${String(f).padStart(4, '0')}.png`) });
    if (f % 30 === 0) process.stdout.write(`frame ${f}/${frames}\r`);
  }
  await browser.close();
  if (process.env.DRY) process.exit(0);
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
