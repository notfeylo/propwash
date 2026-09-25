/* global window, requestAnimationFrame */
// tools/verify-budgets.mjs — `pnpm verify:budgets [baseUrl]`
// Measures the PRD §4.2 budgets and the §4.9 FPV shake into docs/verification/budgets.md:
// initial download and first frame on a throttled 50 Mbps link, frame times at 1440p on High,
// console errors, and FPV camera shake at full throttle. Set CHANNEL=chrome for real WebGPU.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] ?? 'http://localhost:5173';
const MBPS = 50;
const rows = [];
const check = (name, pass, measured) => {
  rows.push({ name, pass, measured });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${measured}`);
};

const browser = await chromium.launch({
  channel: process.env.CHANNEL || undefined,
  args: ['--enable-unsafe-webgpu', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});

// 1. Cold load over a throttled link: bytes on the wire until the first rendered frame.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 20,
    downloadThroughput: (MBPS * 1e6) / 8,
    uploadThroughput: (10 * 1e6) / 8,
  });
  let bytes = 0;
  const byType = {};
  const types = new Map();
  cdp.on('Network.responseReceived', (e) => types.set(e.requestId, e.type));
  cdp.on('Network.loadingFinished', (e) => {
    bytes += e.encodedDataLength;
    const t = types.get(e.requestId) ?? 'Other';
    byType[t] = (byType[t] ?? 0) + e.encodedDataLength;
  });
  const t0 = Date.now();
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => window.__propwash?.ready === true, undefined, { timeout: 60_000, polling: 20 });
  const firstFrame = (Date.now() - t0) / 1000;
  const mb = bytes / 1e6;
  const breakdown = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([t, b]) => `${t} ${(b / 1e6).toFixed(2)}`)
    .join(', ');
  check('Initial download ≤ 8 MB', mb <= 8, `${mb.toFixed(2)} MB transferred before the first frame (${breakdown})`);
  check(
    `First frame ≤ 3 s on ${MBPS} Mbps`,
    firstFrame <= 3,
    `${firstFrame.toFixed(2)} s from navigation to the first rendered frame (20 ms latency)`,
  );
  await page.waitForTimeout(2000);
  check('No console errors on load', errors.length === 0, errors.length ? errors.join(' | ') : 'none');
  await ctx.close();
}

// 2. Frame times at 1440p on High, drone armed at hover-ish throttle (props as blur discs).
const frameStats = async (page, seconds) =>
  page.evaluate(
    (s) =>
      new Promise((resolve) => {
        const dts = [];
        let last = performance.now();
        const end = last + s * 1000;
        const tick = (t) => {
          dts.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(tick);
          else {
            dts.sort((a, b) => a - b);
            const q = (p) => dts[Math.min(dts.length - 1, Math.floor(p * dts.length))];
            resolve({ n: dts.length, median: q(0.5), p95: q(0.95), p99: q(0.99) });
          }
        };
        requestAnimationFrame(tick);
      }),
    seconds,
  );
{
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${BASE}/?quality=high&dynres=0`);
  await page.waitForFunction(() => window.__propwash?.ready === true, undefined, { timeout: 60_000 });
  const backend = await page.evaluate(() => window.__propwash.backend);
  await page.evaluate(() => {
    const p = window.__propwash;
    p.setUiHidden(true);
    p.plug();
  });
  await page.waitForFunction(() => window.__propwash.power().state === 'DISARMED', undefined, { timeout: 20_000 });
  await page.evaluate(() => {
    window.__propwash.arm();
    window.__propwash.setThrottle(0.35);
  });
  await page.waitForTimeout(3000);
  const views = [];
  for (const cam of ['orbit', 'fpv', 'hd']) {
    await page.evaluate((c) => window.__propwash.setCamera(c, true), cam);
    await page.waitForTimeout(1500);
    const s = await frameStats(page, 6);
    views.push(
      `${cam}: median ${s.median.toFixed(1)} ms (${(1000 / s.median).toFixed(0)} fps), p95 ${s.p95.toFixed(1)} ms, p99 ${s.p99.toFixed(1)} ms`,
    );
    rows.push({
      name: `Frame time, ${cam} view, 2560×1440 High (${backend})`,
      pass: s.p95 <= 1000 / 60 + 1,
      measured: views.at(-1),
    });
    console.log(views.at(-1));
  }
  check('No console errors while running', errors.length === 0, errors.length ? errors.join(' | ') : 'none');

  // 3. FPV shake at full throttle: the camera rides the vibrating body.
  await page.evaluate(() => {
    window.__propwash.setCamera('fpv', true);
    window.__propwash.setThrottle(1);
  });
  await page.waitForTimeout(2500);
  const shake = await page.evaluate(async () => {
    const pos = [];
    for (let i = 0; i < 90; i++) {
      pos.push(window.__propwash.camera().position);
      await new Promise((r) => requestAnimationFrame(r));
    }
    const span = (k) => Math.max(...pos.map((p) => p[k])) - Math.min(...pos.map((p) => p[k]));
    return { x: span(0), y: span(1), z: span(2), rpm: window.__propwash.power().rpms[0] };
  });
  const mm = (m) => (m * 1000).toFixed(3);
  const peak = Math.max(shake.x, shake.y, shake.z);
  check(
    'FPV view shakes with the frame (visible, never cartoonish)',
    peak > 1e-5 && peak < 0.002,
    `camera travel over 90 frames at ${Math.round(shake.rpm)} RPM: x ${mm(shake.x)}, y ${mm(shake.y)}, z ${mm(shake.z)} mm peak-to-peak (includes the ±0.05° body rotation at the lens offset)`,
  );
  await page.close();
}
await browser.close();

const gpu = process.env.GPU_NAME ?? 'unknown GPU';
const md = `# Budget verification

Generated by \`pnpm verify:budgets\` (${new Date().toISOString().slice(0, 10)}) against ${BASE}, ${process.env.CHANNEL ? `Chrome (${process.env.CHANNEL})` : 'Playwright Chromium'} on ${os.cpus()[0].model.trim()}, ${gpu}.

| Check | Result | Measurement |
| --- | --- | --- |
${rows.map((r) => `| ${r.name} | ${r.pass ? 'pass' : 'fail'} | ${r.measured} |`).join('\n')}

Frame times are measured with vsync and the frame-rate limit off, so they show headroom rather than the display's refresh. This machine is faster than the PRD's RTX 3060 / M1 budget target, so passing here isn't proof for that class of GPU; the dynamic resolution scale (\`src/config/render.ts\`) is what holds 60 fps on slower hardware.
`;
writeFileSync(path.join(ROOT, 'docs/verification/budgets.md'), md);
console.log('wrote docs/verification/budgets.md');
if (rows.some((r) => !r.pass)) process.exitCode = 1;
