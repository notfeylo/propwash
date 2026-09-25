import { expect, test, type Page } from '@playwright/test';

// PRD §4.4 / §4.9 through the real keyboard path. CI renders in software at a low frame rate,
// so state changes are awaited rather than timed.

const power = (page: Page) => page.evaluate(() => window.__propwash!.power());
const waitState = (page: Page, state: string, timeout = 20_000) =>
  page.waitForFunction((s) => window.__propwash!.power().state === s, state, { timeout });

test.beforeEach(async ({ page }) => {
  await page.goto('/?quality=low&dynres=0');
  await page.waitForFunction(() => window.__propwash?.ready === true, undefined, { timeout: 30_000 });
  await page.locator('canvas').click({ position: { x: 600, y: 200 } }); // focus + audio gesture
  // These tests are about the sim and input, not pixels: skip drawing so software GL on CI
  // doesn't starve the frame loop (sim time would crawl behind the 100 ms dt clamp).
  await page.evaluate(() => window.__propwash!.setRenderPaused(true));
});

test('plug in boots to DISARMED; arming with throttle up is refused', async ({ page }) => {
  expect((await power(page)).state).toBe('OFF');
  await page.keyboard.press('KeyP');
  await waitState(page, 'BOOTING', 5_000);
  await waitState(page, 'DISARMED');

  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__propwash!.power().throttle > 0.1, undefined, { timeout: 10_000 });
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__propwash!.power().warning === 'THROTTLE', undefined, { timeout: 5_000 });
  expect((await power(page)).state).toBe('DISARMED');

  await page.keyboard.press('Digit0');
  await page.waitForFunction(() => window.__propwash!.power().warning === null, undefined, { timeout: 5_000 });
});

test('arming at zero throttle spins to idle; disarm coasts; unplug powers off', async ({ page }) => {
  await page.keyboard.press('KeyP');
  await waitState(page, 'DISARMED');
  await page.keyboard.press('Space');
  await waitState(page, 'ARMED', 5_000);
  await page.waitForFunction(
    () => window.__propwash!.power().rpms.every((r) => Math.abs(r / 2400 - 1) < 0.03),
    undefined,
    {
      timeout: 20_000,
    },
  );
  // The props on screen follow the motor model.
  const shown = await page.evaluate(() => window.__propwash!.rotors().map((r) => r.rpm));
  expect(shown.every((r) => r > 2000)).toBe(true);

  await page.keyboard.press('Space');
  await waitState(page, 'DISARMED', 5_000);
  const coasting = (await power(page)).rpms;
  expect(coasting.every((r) => r > 0 && r < 2500)).toBe(true);
  await page.keyboard.press('KeyP');
  await waitState(page, 'OFF', 5_000);
});

test('X kills instantly while armed', async ({ page }) => {
  await page.keyboard.press('KeyP');
  await waitState(page, 'DISARMED');
  await page.keyboard.press('Space');
  await waitState(page, 'ARMED', 5_000);
  await page.keyboard.press('KeyX');
  await waitState(page, 'DISARMED', 5_000);
});

test('procedural audio renders offline (the public build has no recording)', async ({ page }) => {
  const r = await page.evaluate(() =>
    window.__propwash!.renderAudio({
      durationS: 2.4,
      steps: [
        { at: 0.1, do: 'plug' },
        { at: 1.5, do: 'arm' },
        { at: 1.8, do: { throttle: 0.4 } },
      ],
    }),
  );
  expect(r.mode).toBe('procedural');
  const pcm = Buffer.from(r.left, 'base64');
  const i16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const tail = i16.subarray(Math.round(2.0 * r.sampleRate));
  const rms = Math.sqrt(tail.reduce((s, v) => s + (v / 32767) ** 2, 0) / tail.length);
  expect(20 * Math.log10(rms)).toBeGreaterThan(-45);
  expect(20 * Math.log10(rms)).toBeLessThan(-3);
  expect(r.frames.some((f) => f.events.includes('escPowerOnTones'))).toBe(true);
});

test('arm presses that are refused say why; unplugged ones are silent', async ({ page }) => {
  const toast = page.locator('.pw-toast.pw-show');
  await page.keyboard.press('Space');
  await expect(toast).toContainText('Battery unplugged');
  expect((await power(page)).state).toBe('OFF');

  await page.keyboard.press('KeyP');
  await page.keyboard.press('Space');
  await expect(toast).toContainText('ESCs starting');
  await waitState(page, 'DISARMED');
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__propwash!.power().throttle > 0.1, undefined, { timeout: 10_000 });
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Space');
  await expect(toast).toContainText('throttle above 5%');

  // No buzzer from an unpowered flight controller.
  const r = await page.evaluate(() =>
    window.__propwash!.renderAudio({ durationS: 0.8, steps: [{ at: 0.1, do: 'arm' }] }),
  );
  const pcm = Buffer.from(r.left, 'base64');
  const i16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  expect(i16.every((v) => v === 0)).toBe(true);
  expect(r.frames.some((f) => f.events.includes('armRefused'))).toBe(true);
});
