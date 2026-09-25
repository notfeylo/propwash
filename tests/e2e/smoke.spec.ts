import { expect, test } from '@playwright/test';
import sharp from 'sharp';

test('page loads, drone renders, no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.waitForFunction(() => window.__propwash?.ready === true, undefined, { timeout: 30_000 });
  await page.waitForTimeout(500);

  const png = await page.locator('canvas').screenshot({ path: 'test-results/smoke.png' });
  const { channels } = await sharp(png).stats();
  const spread = Math.max(...channels.slice(0, 3).map((c) => c.stdev));
  expect(spread, 'canvas should not be a flat colour').toBeGreaterThan(4);

  expect(errors).toEqual([]);
});
