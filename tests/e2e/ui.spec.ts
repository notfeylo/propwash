import { expect, test, type Page } from '@playwright/test';

// PRD §4.8: HUD, Motor Test Panel and Settings, driven through the real UI.

const waitState = (page: Page, state: string, timeout = 20_000) =>
  page.waitForFunction((s) => window.__propwash!.power().state === s, state, { timeout });

test.beforeEach(async ({ page }) => {
  await page.goto('/?quality=low&dynres=0');
  await page.waitForFunction(() => window.__propwash?.ready === true, undefined, { timeout: 30_000 });
  await page.locator('canvas[data-engine]').click({ position: { x: 600, y: 300 } });
  await page.evaluate(() => window.__propwash!.setRenderPaused(true));
});

test('HUD shows state, battery and per-motor RPM', async ({ page }) => {
  const hud = page.locator('.pw-hud');
  await expect(hud.locator('.pw-badge')).toHaveText('OFF');
  await expect(hud).toContainText('NO BATT');
  await page.keyboard.press('KeyP');
  await waitState(page, 'DISARMED');
  await expect(hud.locator('.pw-badge')).toHaveText('DISARMED');
  await expect(hud).toContainText('25.2 V');
  await page.keyboard.press('Space');
  await expect(hud.locator('.pw-badge')).toHaveText('ARMED');
  await page.waitForFunction(
    () => document.querySelectorAll('.pw-motor b')[0]?.textContent?.startsWith('2,4'),
    undefined,
    {
      timeout: 10_000,
    },
  );
});

test('motor test: safety gate, per-motor sliders, arming blocked', async ({ page }) => {
  await page.keyboard.press('KeyP');
  await waitState(page, 'DISARMED');
  await page.keyboard.press('KeyM');
  const panel = page.locator('.pw-mt');
  await expect(panel).toHaveClass(/pw-open/);
  await expect(panel.locator('[data-m="1"]')).toBeDisabled();
  await panel.getByLabel('I understand the props are on').check();
  await expect(panel.locator('[data-m="1"]')).toBeEnabled();
  await panel.locator('[data-m="1"]').fill('60');
  await page.waitForFunction(() => {
    const r = window.__propwash!.power().rpms;
    return r[1] > 10_000 && r[0] === 0 && r[2] === 0 && r[3] === 0;
  });
  await expect(page.locator('.pw-hud .pw-badge')).toHaveText('MOTOR TEST');

  await page.locator('canvas[data-engine]').click({ position: { x: 300, y: 300 } });
  await page.keyboard.press('Space');
  await expect(page.locator('.pw-toast.pw-show')).toContainText('Motor test is on');
  expect((await page.evaluate(() => window.__propwash!.power())).state).toBe('DISARMED');

  await page.keyboard.press('KeyM'); // close: motors coast, sliders reset
  await expect(panel).not.toHaveClass(/pw-open/);
  await expect(panel.locator('[data-m="1"]')).toHaveValue('0');
  await page.keyboard.press('Space');
  await waitState(page, 'ARMED', 5_000);
});

test('settings apply live and persist across reloads; keys can be rebound', async ({ page }) => {
  await page.keyboard.press('KeyO');
  const set = page.locator('.pw-set');
  await expect(set).toHaveClass(/pw-open/);
  await set.locator('[data-tab="Camera"]').click();
  await set.locator('[data-k="uptiltDeg"]').fill('40');
  await set.locator('[data-k="feed"]').selectOption('digital');
  await set.locator('[data-tab="Drone"]').click();
  await set.locator('[data-k="payload"]').uncheck();
  await set.locator('[data-tab="Controls"]').click();
  await set.locator('[data-key="armToggle"]').click();
  await page.keyboard.press('KeyJ');
  await expect(set.locator('[data-key="armToggle"]')).toHaveText('J');
  await set.locator('[data-tab="Credits"]').click();
  await expect(set).toContainText('FPV-dron_NonStop');
  await expect(set).toContainText('Viktor_');

  let c = await page.evaluate(() => window.__propwash!.camera());
  expect(c.uptiltDeg).toBe(40);
  expect(c.feed).toBe('digital');

  await page.reload();
  await page.waitForFunction(() => window.__propwash?.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__propwash!.setRenderPaused(true));
  c = await page.evaluate(() => window.__propwash!.camera());
  expect(c.uptiltDeg).toBe(40);
  expect(c.feed).toBe('digital');
  expect(await page.evaluate(() => window.__propwash!.groundOffset())).toBeLessThan(0); // payload hidden: frame rests lower

  await page.locator('canvas[data-engine]').click({ position: { x: 600, y: 300 } });
  await page.keyboard.press('KeyP');
  await waitState(page, 'DISARMED');
  await page.keyboard.press('KeyJ');
  await waitState(page, 'ARMED', 5_000);
});
