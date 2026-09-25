import { expect, test, type Page } from '@playwright/test';

// PRD §4.6 through the real keyboard: C cycles views, V the FPV feed; the OSD follows power state.

const cam = (page: Page) => page.evaluate(() => window.__propwash!.camera());
const waitMode = (page: Page, mode: string) =>
  page.waitForFunction((m) => window.__propwash!.camera().mode === m && !window.__propwash!.camera().cutting, mode, {
    timeout: 10_000,
  });

test.beforeEach(async ({ page }) => {
  await page.goto('/?quality=low&dynres=0');
  await page.waitForFunction(() => window.__propwash?.ready === true, undefined, { timeout: 30_000 });
  await page.locator('canvas[data-engine]').click({ position: { x: 600, y: 200 } });
  await page.evaluate(() => window.__propwash!.setRenderPaused(true));
});

test('C cycles Orbit → FPV → HD → Orbit with the right overlays', async ({ page }) => {
  expect((await cam(page)).mode).toBe('orbit');
  await page.keyboard.press('KeyC');
  await waitMode(page, 'fpv');
  let c = await cam(page);
  expect(c.feed).toBe('analog');
  expect(c.box.width / c.box.height).toBeCloseTo(4 / 3, 2);
  expect(c.osd).toEqual(['NO SIGNAL']);

  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__propwash!.power().state === 'DISARMED', undefined, { timeout: 20_000 });
  await page.waitForFunction(() => window.__propwash!.camera().osd.includes('DISARMED'), undefined, { timeout: 5_000 });
  c = await cam(page);
  expect(c.osd).toEqual(expect.arrayContaining(['RSSI 99', 'ACRO', '25.2V', '00:00']));
  // Cell average of a fresh 6S pack; the electronics' draw can sag it a few mV below 4.20.
  expect(c.osd.some((l) => /^4\.(19|20)V$/.test(l))).toBe(true);

  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.__propwash!.camera().feed === 'digital', undefined, { timeout: 5_000 });
  c = await cam(page);
  expect(c.box.width / c.box.height).toBeCloseTo(16 / 9, 2);

  await page.keyboard.press('KeyC');
  await waitMode(page, 'hd');
  await page.waitForFunction(() => window.__propwash!.camera().osd.some((l) => l.startsWith('REC ')), undefined, {
    timeout: 5_000,
  });

  await page.keyboard.press('KeyC');
  await waitMode(page, 'orbit');
  expect((await cam(page)).osd).toEqual([]);
});

test('FPV camera rides on the drone mount with 25° uptilt', async ({ page }) => {
  await page.evaluate(() => window.__propwash!.setCamera('fpv', true));
  const c = await cam(page);
  expect(c.uptiltDeg).toBe(25);
  // Mount sits just ahead of the lens, in front of the frame's centre (nose = −Z).
  expect(c.position[2]).toBeLessThan(-0.05);
  expect(c.position[1]).toBeGreaterThan(0.03);
});
