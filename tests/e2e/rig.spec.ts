import { expect, test } from '@playwright/test';

// PRD §2.1: rotor pivots (±0.1217, 0.0700, ±0.1233) m; nose = −Z. §4.9: props turn about fixed bell centers.
const PIVOTS: Record<string, [number, number]> = {
  rotor_RR: [0.1217, 0.1233],
  rotor_FR: [0.1217, -0.1233],
  rotor_RL: [-0.1217, 0.1233],
  rotor_FL: [-0.1217, -0.1233],
};
const SPIN: Record<string, 'CW' | 'CCW'> = { rotor_RR: 'CW', rotor_FR: 'CCW', rotor_RL: 'CCW', rotor_FL: 'CW' };
const MM = 0.001;

test.beforeEach(async ({ page }) => {
  await page.goto('/?quality=low&dynres=0');
  await page.waitForFunction(() => window.__propwash?.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__propwash!.freeze(true));
});

test('rotor pivots sit on the motor axes from the PRD', async ({ page }) => {
  const rotors = await page.evaluate(() => window.__propwash!.rotors());
  expect(rotors.map((r) => r.motor)).toEqual([1, 2, 3, 4]);
  for (const r of rotors) {
    const [x, z] = PIVOTS[r.name];
    expect(Math.abs(r.pivotWorld[0] - x)).toBeLessThan(0.5 * MM);
    expect(Math.abs(r.pivotWorld[2] - z)).toBeLessThan(0.5 * MM);
    expect(r.spin).toBe(SPIN[r.name]);
  }
});

test('hubs stay on their axes as the props turn (no orbit or wobble)', async ({ page }) => {
  const at = (deg: number) =>
    page.evaluate((d) => {
      window.__propwash!.setRotorAngles(d);
      return window.__propwash!.rotors();
    }, deg);
  const a = await at(0);
  const b = await at(60);
  a.forEach((r, i) => {
    const off = Math.hypot(r.hubCentroidWorld[0] - r.pivotWorld[0], r.hubCentroidWorld[2] - r.pivotWorld[2]);
    const moved = Math.hypot(...r.hubCentroidWorld.map((v, k) => v - b[i].hubCentroidWorld[k]));
    expect(off, `${r.name} hub centroid off-axis`).toBeLessThan(0.5 * MM);
    expect(moved, `${r.name} hub centroid moved 0°→60°`).toBeLessThan(0.5 * MM);
    expect(b[i].pivotWorld).toEqual(r.pivotWorld);
  });
});

test('spin directions match the Betaflight props-in table', async ({ page }) => {
  const rotors = await page.evaluate(() => {
    const d = window.__propwash!;
    d.setRotorAngles(0);
    d.setRpm(10); // 60°/s
    d.step(0.5);
    return new Promise<ReturnType<typeof d.rotors>>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r(d.rotors()))),
    );
  });
  for (const r of rotors) {
    // CCW from above = +Y rotation = angle increases; CW wraps below 360.
    expect(r.angleDeg).toBeCloseTo(r.spin === 'CCW' ? 30 : 330, 3);
  }
});

test('prop visuals switch stages by RPM', async ({ page }) => {
  const at = (rpm: number) =>
    page.evaluate(async (r) => {
      const d = window.__propwash!;
      d.setRpm(r);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      return d.rotors()[0].weights;
    }, rpm);
  expect(await at(0)).toEqual({ mesh: 1, smear: 0, disc: 0 });
  const mid = await at(1500);
  expect(mid.smear).toBe(1);
  expect(mid.mesh).toBeGreaterThan(0);
  expect(await at(11000)).toEqual({ mesh: 0, smear: 0, disc: 1 });
});

test('ground offset follows the payload toggle', async ({ page }) => {
  const withPayload = await page.evaluate(() => window.__propwash!.groundOffset());
  const without = await page.evaluate(() => {
    window.__propwash!.setPayloadVisible(false);
    return window.__propwash!.groundOffset();
  });
  // PRD §2.1: canister bottom at y = −0.012 m. The PRD's "frame bottom ≈ −0.004 m" was the
  // canister straps; they now hide with the payload, so the bottom plate (+0.052 m) is lowest.
  expect(withPayload).toBeCloseTo(0.012, 3);
  expect(without).toBeCloseTo(-0.052, 3);
});
