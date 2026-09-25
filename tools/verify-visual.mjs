/* global window */
// tools/verify-visual.mjs — `pnpm verify:visual [baseUrl]`
// Renders the PRD §4.9 visual checks for the scene and drone rig into docs/verification/.
// Needs a running server (`pnpm dev` or `pnpm preview`). Set CHANNEL=chrome to render
// through an installed Chrome (real WebGPU) instead of Playwright's Chromium (WebGL2).
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/verification');
const BASE = process.argv[2] ?? 'http://localhost:5173';
const W = 1280;
const H = 720;
const JPEG = { quality: 90, mozjpeg: true };
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.CHANNEL || undefined,
  args: ['--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

async function open(query = '') {
  await page.goto(`${BASE}/?quality=high&dynres=0${query}`);
  await page.waitForFunction(() => window.__propwash?.ready === true, undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    window.__propwash.freeze(true);
    window.__propwash.setUiHidden(true); // HUD off (H); the OSD stays, it's part of the video
  });
}
/** Let TRAA converge on a static frame. */
const settle = (ms = 900) => page.waitForTimeout(ms);
const d = (fn, arg) => page.evaluate(fn, arg);

const svg = (body) => Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
const text = (x, y, s, size = 22, fill = '#fff') =>
  `<text x="${x}" y="${y}" font-family="Consolas, monospace" font-size="${size}" fill="${fill}" stroke="#000" stroke-width="3" paint-order="stroke">${s}</text>`;
const cross = (x, y, color = '#00e5ff') =>
  `<g stroke="${color}" stroke-width="2"><line x1="${x - 14}" y1="${y}" x2="${x + 14}" y2="${y}"/><line x1="${x}" y1="${y - 14}" x2="${x}" y2="${y + 14}"/><circle cx="${x}" cy="${y}" r="5" fill="none"/></g>`;

async function shot(name, overlay) {
  const raw = await page.screenshot();
  const png = overlay
    ? await sharp(raw)
        .composite([{ input: svg(overlay), top: 0, left: 0 }])
        .png()
        .toBuffer()
    : raw;
  await sharp(png).jpeg(JPEG).toFile(path.join(OUT, name));
  console.log('wrote', path.relative(ROOT, path.join(OUT, name)));
  // Unannotated, so blends don't double up labels.
  return raw;
}

/** Per-pixel mix of two same-size captures: a·(1−t) + b·t. */
async function mix(a, b, t) {
  const [ra, rb] = await Promise.all(
    [a, b].map((x) => sharp(x).removeAlpha().raw().toBuffer({ resolveWithObject: true })),
  );
  const out = Buffer.alloc(ra.data.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(ra.data[i] * (1 - t) + rb.data[i] * t);
  return sharp(out, { raw: ra.info }).png().toBuffer();
}

// Near-orthographic top-down: far away with a narrow FOV, nose (−Z) up.
const topDown = () =>
  d(() => {
    const y = window.__propwash.rotors()[0].pivotWorld[1];
    window.__propwash.setView([0, y + 4, 0.0001], [0, y, 0], 7);
  });

async function pivotOverlay(label) {
  const rotors = await d(() => window.__propwash.rotors());
  const marks = await Promise.all(
    rotors.map(async (r) => ({ r, p: await d((w) => window.__propwash.project(w), r.pivotWorld) })),
  );
  return (
    marks.map(({ r, p }) => cross(p[0], p[1]) + text(p[0] + 18, p[1] - 18, `M${r.motor}`, 18, '#00e5ff')).join('') +
    text(20, 40, label) +
    text(20, H - 20, 'crosshair = motor axis (rotor pivot)  ·  nose (−Z) up', 18, '#bbb')
  );
}

// 1. Bench scene, both backdrops.
await open();
await settle(1500);
await shot('bench-gradient.jpg');
await d(() => window.__propwash.setBackground('hdri'));
await settle(1500);
await shot('bench-hdri.jpg');

// 2. Rotor angles 0° and 60°, top-down, pivots marked; plus a 50/50 overlay.
await open();
await topDown();
await d(() => window.__propwash.setRotorAngles(0));
await settle();
const a0 = await shot('rotor-angle-0.jpg', await pivotOverlay('rotor angle 0°'));
await d(() => window.__propwash.setRotorAngles(60));
await settle();
const a60 = await shot('rotor-angle-60.jpg', await pivotOverlay('rotor angle 60°'));
await sharp(await mix(a0, a60, 0.5))
  .composite([
    { input: svg(await pivotOverlay('overlay of 0° and 60°: blades move, hubs stay on the axes')), top: 0, left: 0 },
  ])
  .jpeg(JPEG)
  .toFile(path.join(OUT, 'rotor-angle-overlay.jpg'));
console.log('wrote docs/verification/rotor-angle-overlay.jpg');

// 3. Spin directions: debug arrows vs. the simulated rotation. One real blade-tip vertex is
// tracked through the renderer's transforms while the sim steps at 20 RPM (15° per step);
// its numbered positions must advance the way the arrow points.
await d(() => {
  const p = window.__propwash;
  p.setSpinArrows(true);
  p.setRotorAngles(0);
  p.setRpm(20);
  const y = p.rotors()[0].pivotWorld[1];
  p.setView([0, y + 4, 0.0001], [0, y, 0], 9.5);
});
const trail = [];
for (let i = 0; i < 5; i++) {
  if (i) await d(() => window.__propwash.step(0.125));
  await settle(250);
  trail.push(
    await d(() =>
      window.__propwash.rotors().map((r) => ({ spin: r.spin, tip: window.__propwash.project(r.bladeTipWorld) })),
    ),
  );
}
await settle(700);
const dots = trail[0]
  .map((_, ri) => {
    const pts = trail.map((step) => step[ri].tip);
    const color = trail[0][ri].spin === 'CW' ? '#ff6a2a' : '#27c7ff';
    const line = `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="4 3"/>`;
    const marks = pts
      .map(
        ([x, y], i) =>
          `<circle cx="${x}" cy="${y}" r="7" fill="${color}" stroke="#000" stroke-width="2"/>` +
          text(x + 9, y - 9, String(i + 1), 16, '#fff'),
      )
      .join('');
    return line + marks;
  })
  .join('');
await shot(
  'spin-directions.jpg',
  dots +
    text(20, 40, 'spin: arrows (commanded) vs. a tracked blade tip, sim stepped 15° per dot (1 → 5)') +
    text(20, H - 20, 'orange = CW (M1, M4), blue = CCW (M2, M3), seen from above, nose up', 18, '#bbb'),
);

// 4. Prop stages by RPM on one rotor (frozen clock, smear sized for a 60 fps frame).
await open();
await d(() => {
  const p = window.__propwash;
  p.setRotorAngles(20);
  const [x, y, z] = p.rotors()[2].pivotWorld;
  p.setView([x + 0.03, y + 0.2, z + 0.1], [x, y, z], 40);
});
const rpms = [0, 300, 600, 1000, 1500, 2000, 2300, 2600, 3200, 6000, 11000, 30000];
const tiles = [];
for (const rpm of rpms) {
  await d((r) => window.__propwash.setRpm(r), rpm);
  await settle();
  const w = await d(() => window.__propwash.rotors()[2].weights);
  const label = `${rpm} rpm · mesh ${w.mesh.toFixed(2)} smear ${w.smear.toFixed(2)} disc ${w.disc.toFixed(2)}`;
  const png = await page.screenshot();
  const labelled = await sharp(png)
    .composite([{ input: svg(text(20, 50, label, 34)), top: 0, left: 0 }])
    .png()
    .toBuffer();
  tiles.push(
    await sharp(labelled)
      .resize(W / 2)
      .png()
      .toBuffer(),
  );
}
const cols = 4;
await sharp({
  create: { width: (W / 2) * cols, height: (H / 2) * (rpms.length / cols), channels: 3, background: '#000' },
})
  .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * (W / 2), top: Math.floor(i / cols) * (H / 2) })))
  .png()
  .jpeg(JPEG)
  .toFile(path.join(OUT, 'prop-stages.jpg'));
console.log('wrote docs/verification/prop-stages.jpg');

// 5. LEDs lit (FC solid blue, VTX green, rear strip on), from the right-rear.
await open();
await d(() => {
  const p = window.__propwash;
  p.setLeds('solid', 'green', true);
  const y = p.rotors()[0].pivotWorld[1];
  p.setView([0.2, y - 0.005, 0.08], [0, y - 0.015, 0.03], 40);
});
await settle(1200);
await shot('leds.jpg');

// 6. Payload hidden: canister and its straps go; the frame drops to rest on the pad.
await open();
const withPayload = await d(() => window.__propwash.groundOffset());
await d(() => {
  const p = window.__propwash;
  p.setPayloadVisible(false);
  p.setView([0.36, 0.06, 0.1], [0, 0.03, 0], 40);
});
await settle(1200);
const offset = await d(() => window.__propwash.groundOffset());
const mm = (m) => (m * 1000).toFixed(1);
await shot(
  'payload-hidden.jpg',
  text(20, 40, `payload + straps hidden · lowest point ${mm(-withPayload)} → ${mm(-offset)} mm (body frame)`),
);

// 7. Camera views (§4.6): FPV with no signal, analog and digital feeds with the OSD and the
// props in frame, and the HD view with its REC indicator. The sim runs live here.
await open();
await d(() => {
  const p = window.__propwash;
  p.freeze(false);
  p.setCamera('fpv', true);
});
await settle(1200);
await shot('camera-fpv-no-signal.jpg');
await d(() => window.__propwash.plug());
await page.waitForFunction(() => window.__propwash.power().state === 'DISARMED', undefined, { timeout: 20_000 });
await settle(1200);
await shot('camera-fpv-analog-disarmed.jpg');
await d(() => {
  const p = window.__propwash;
  p.arm();
  p.setThrottle(0.3);
});
await settle(2500);
await shot('camera-fpv-analog-armed.jpg');
await d(() => window.__propwash.setFeed('digital'));
await settle(1200);
await shot('camera-fpv-digital-armed.jpg');
await d(() => window.__propwash.setCamera('hd', true));
await settle(1200);
await shot('camera-hd.jpg');

const backend = await d(() => window.__propwash.backend);
console.log(`backend: ${backend}`);
await browser.close();
if (errors.length) {
  console.error('console errors:\n' + errors.join('\n'));
  process.exit(1);
}
