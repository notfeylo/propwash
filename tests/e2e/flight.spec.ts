import { expect, test, type Page } from '@playwright/test';

// Phase 2 groups 5–6 in the browser: fly a short flight with the sim clock stepped, then replay it
// (resimulated from the checkpoint + inputs, must be bit-identical), look at it through the
// Chase, LOS and HD cameras (horizon lock), and open the Flight Lab.

const ph = (page: Page) => page.evaluate.bind(page);

async function step(page: Page, seconds: number) {
  // The frozen clock advances by `seconds` on the next frame; wait until it has.
  const t0 = await page.evaluate(() => window.__propwash!.recording()?.seconds ?? 0);
  await page.evaluate((s) => window.__propwash!.step(s), seconds);
  await page.waitForTimeout(50);
  return t0;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?quality=low&dynres=0');
  await page.waitForFunction(() => window.__propwash?.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__propwash!.setRenderPaused(true));
  await page.waitForFunction(() => window.__propwash!.flight() !== null, undefined, { timeout: 30_000 });
});

test('a flight is recorded, replays bit-identically, and the new cameras follow it', async ({ page }) => {
  test.setTimeout(180_000);
  const e = ph(page);
  await e(() => window.__propwash!.plug());
  await page.waitForFunction(() => window.__propwash!.power().state === 'DISARMED', undefined, { timeout: 20_000 });
  await e(() => {
    const p = window.__propwash!;
    p.freeze(true);
    p.setFlightMode('angle');
    p.setThrottle(0);
    p.arm();
  });
  await step(page, 0.6);
  await e(() => {
    window.__propwash!.setThrottle(0.5);
    window.__propwash!.setSticks({ roll: 0.4, pitch: 0.25, yaw: 0.1 });
  });
  for (let i = 0; i < 4; i++) await step(page, 0.5);
  await e(() => {
    window.__propwash!.setThrottle(0.2);
    window.__propwash!.setSticks({ roll: 0, pitch: 0, yaw: 0 });
  });
  await step(page, 0.8);
  await e(() => window.__propwash!.disarm());
  await step(page, 0.5);
  await page.waitForFunction(() => (window.__propwash!.recording()?.seconds ?? 0) > 3, undefined, { timeout: 20_000 });
  const rec = await e(() => window.__propwash!.recording());
  expect(rec!.samples).toBeGreaterThan(1500);
  expect(rec!.ops).toBeGreaterThan(3);

  // The CSV has Betaflight's column names.
  const header = (await e(() => window.__propwash!.blackboxCsv()))!.split('\n')[0];
  for (const c of ['time (us)', 'gyroADC[0]', 'setpoint[0]', 'rcCommand[3]', 'motor[0]']) expect(header).toContain(c);

  // Replay: resimulated in the background, compared sample by sample with the recording.
  await e(() => window.__propwash!.startReplay());
  await page.waitForFunction(
    () => {
      const r = window.__propwash!.replay();
      return r !== null && r.ready >= r.duration - 1e-6;
    },
    undefined,
    { timeout: 120_000 },
  );
  const rp = await e(() => window.__propwash!.replay());
  expect(rp!.mismatch).toBe(-1);
  expect(Math.abs(rp!.duration - rec!.seconds)).toBeLessThan(0.01);

  // Pause mid-flight (banked right) and look at it through each view.
  await page.locator('canvas[data-engine]').click({ position: { x: 600, y: 200 } });
  await e(() => window.__propwash!.seekReplay(1.8));
  if ((await e(() => window.__propwash!.replay()!.playing)) === true) await page.keyboard.press('Space');
  await e(() => window.__propwash!.seekReplay(1.8));
  await page.waitForTimeout(300);

  await e(() => window.__propwash!.setCamera('chase', true));
  await page.waitForTimeout(400);
  const chase = await e(() => window.__propwash!.camera());
  const drone = await e(() => window.__propwash!.dronePosition());
  const dist = Math.hypot(chase.position[0] - drone[0], chase.position[1] - drone[1], chase.position[2] - drone[2]);
  expect(chase.mode).toBe('chase');
  expect(dist).toBeGreaterThan(1);
  expect(dist).toBeLessThan(4);
  expect(chase.position[1]).toBeGreaterThan(drone[1]);

  await e(() => window.__propwash!.setCamera('los', true));
  await page.waitForTimeout(300);
  const los = await e(() => window.__propwash!.camera());
  expect(los.position[1]).toBeGreaterThan(1.6);
  expect(los.position[2]).toBeCloseTo(5, 1);

  await e(() => window.__propwash!.setCamera('hd', true));
  await e(() => window.__propwash!.setHdStabilization('raw'));
  await page.waitForTimeout(300);
  const raw = await e(() => window.__propwash!.camera());
  await e(() => window.__propwash!.setHdStabilization('horizon'));
  await page.waitForTimeout(600);
  const locked = await e(() => window.__propwash!.camera());
  expect(Math.abs(raw.rollDeg)).toBeGreaterThan(4);
  expect(Math.abs(locked.rollDeg)).toBeLessThan(0.5);
  expect(locked.osd.some((l) => l.startsWith('REC '))).toBe(true);

  // Flight Lab: the recording's graphs.
  await e(() => window.__propwash!.openFlightLab(true));
  await page.locator('.pw-fl [data-tab="Flight"]').click();
  await expect(page.locator('.pw-fl.pw-open .uplot')).toHaveCount(5, { timeout: 10_000 });
  await page.locator('.pw-fl [data-tab="Step response"]').click();
  await expect(page.locator('.pw-fl .pw-fl-metrics')).toBeVisible();

  await e(() => window.__propwash!.stopReplay());
  expect(await e(() => window.__propwash!.replay())).toBeNull();
});

test('C cycles all five views; K cycles HD stabilization', async ({ page }) => {
  await page.locator('canvas[data-engine]').click({ position: { x: 600, y: 200 } });
  for (const m of ['fpv', 'chase', 'los', 'hd', 'orbit']) {
    await page.keyboard.press('KeyC');
    await page.waitForFunction(
      (mode) => window.__propwash!.camera().mode === mode && !window.__propwash!.camera().cutting,
      m,
      { timeout: 5_000 },
    );
  }
  const before = await page.evaluate(() => window.__propwash!.camera().hdStabilization);
  await page.keyboard.press('KeyK');
  await page.waitForFunction((b) => window.__propwash!.camera().hdStabilization !== b, before, { timeout: 5_000 });
});
