import { expect, test, type Page } from '@playwright/test';

// PRD §4.7 through the real frame loop, with a simulated DualShock 4 behind navigator.getGamepads
// (Chrome "standard" mapping) that records rumble effects.

declare global {
  interface Window {
    __pad: {
      set(p: { axes?: number[]; pressed?: number[]; values?: Record<number, number> }): void;
      rumble: { weakMagnitude: number; strongMagnitude: number; duration: number }[];
    };
  }
}

const B = { circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, r2: 7, options: 9 };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const rumble: Window['__pad']['rumble'] = [];
    // Mode 2: left stick Y is the throttle (+1 = bottom = 0%), as in the Phase 2 default.
    const state = { axes: [0, 1, 0, 0], pressed: [] as number[], values: {} as Record<number, number> };
    const snapshot = () => ({
      id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
      index: 0,
      mapping: 'standard',
      connected: true,
      timestamp: performance.now(),
      axes: [...state.axes],
      buttons: Array.from({ length: 18 }, (_, i) => {
        const value = state.values[i] ?? (state.pressed.includes(i) ? 1 : 0);
        return { pressed: value > 0.5, touched: value > 0, value };
      }),
      vibrationActuator: {
        type: 'dual-rumble',
        playEffect: (_t: string, p: { weakMagnitude: number; strongMagnitude: number; duration: number }) => {
          rumble.push(p);
          return Promise.resolve('complete');
        },
      },
    });
    window.__pad = {
      set: (p) => Object.assign(state, { axes: [0, 1, 0, 0], pressed: [], values: {} }, p),
      rumble,
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [snapshot(), null, null, null] });
  });
  await page.goto('/?quality=low&dynres=0');
  await page.waitForFunction(() => window.__propwash?.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__propwash!.setRenderPaused(true));
});

const pad = (page: Page, p: Parameters<Window['__pad']['set']>[0]) => page.evaluate((s) => window.__pad.set(s), p);
const waitState = (page: Page, state: string, timeout = 20_000) =>
  page.waitForFunction((s) => window.__propwash!.power().state === s, state, { timeout });
/** Press and release, holding long enough for a slow software-rendered frame loop to see it. */
async function tap(page: Page, buttons: number[]) {
  await pad(page, { pressed: buttons });
  await page.waitForTimeout(250);
  await pad(page, {});
  await page.waitForTimeout(150);
}

test('PS4 pad: hold Options to plug, R1 arms, left stick throttles, L1+R1 kills', async ({ page }) => {
  await page.waitForFunction(() => window.__propwash!.input().pads.length === 1);
  expect((await page.evaluate(() => window.__propwash!.input().pads))[0]).toMatchObject({
    kind: 'gamepad',
    name: 'DualShock 4',
  });

  await tap(page, [B.options]); // a tap isn't enough
  expect((await page.evaluate(() => window.__propwash!.power())).state).toBe('OFF');
  await pad(page, { pressed: [B.options] });
  await waitState(page, 'BOOTING', 5_000);
  await pad(page, {});
  await waitState(page, 'DISARMED');

  // R2 held: arming is refused with the pad's hint.
  await pad(page, { axes: [0, 0.2, 0, 0] });
  await page.waitForTimeout(200);
  await pad(page, { axes: [0, 0.2, 0, 0], pressed: [B.r1] });
  await expect(page.locator('.pw-toast.pw-show')).toContainText('Lower the throttle');
  await pad(page, {});
  await page.waitForTimeout(200);

  await tap(page, [B.r1]);
  await waitState(page, 'ARMED', 5_000);
  const input = await page.evaluate(() => window.__propwash!.input().state);
  expect(input?.device).toBe('gamepad');

  await pad(page, { axes: [0, -1, 0, 0] });
  await page.waitForFunction(() => window.__propwash!.power().rpms.every((r) => r > 15_000), undefined, {
    timeout: 10_000,
  });
  expect((await page.evaluate(() => window.__propwash!.power())).throttle).toBeCloseTo(1, 2);
  // Rumble follows the motors, and arming sent a strong pulse.
  const rumble = await page.evaluate(() => window.__pad.rumble);
  expect(rumble.some((r) => r.strongMagnitude > 0)).toBe(true);
  expect(rumble.at(-1)!.weakMagnitude).toBeGreaterThan(0.1);

  await pad(page, { axes: [0, -1, 0, 0], pressed: [B.l1] });
  await page.waitForTimeout(150);
  await pad(page, { axes: [0, -1, 0, 0], pressed: [B.l1, B.r1] });
  await waitState(page, 'DISARMED', 5_000);
});

test('PS4 pad: Triangle cycles cameras, Square switches the feed, Circle toggles the beacon', async ({ page }) => {
  await page.waitForFunction(() => window.__propwash!.input().pads.length === 1);
  await tap(page, [B.triangle]);
  await page.waitForFunction(() => window.__propwash!.camera().mode === 'fpv', undefined, { timeout: 5_000 });
  await tap(page, [B.square]);
  await page.waitForFunction(() => window.__propwash!.camera().feed === 'digital', undefined, { timeout: 5_000 });
  await pad(page, { pressed: [B.options] });
  await waitState(page, 'BOOTING', 5_000);
  await pad(page, {});
  await waitState(page, 'DISARMED');
  await tap(page, [B.circle]);
  await page.waitForFunction(() => window.__propwash!.power().beacon === true, undefined, { timeout: 5_000 });
});

test('keyboard still works alongside a pad; H hides the HUD', async ({ page }) => {
  await page.locator('canvas[data-engine]').click({ position: { x: 600, y: 200 } });
  await page.keyboard.press('KeyP');
  await waitState(page, 'DISARMED');
  await page.keyboard.press('Space');
  await waitState(page, 'ARMED', 5_000);
  expect((await page.evaluate(() => window.__propwash!.input().state))?.device).toBe('keyboard');
  await page.keyboard.press('KeyH');
  await expect(page.locator('body')).toHaveClass(/pw-hide-ui/);
  await page.keyboard.press('KeyH');
  await expect(page.locator('body')).not.toHaveClass(/pw-hide-ui/);
});
