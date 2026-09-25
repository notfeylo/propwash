import { defineConfig, devices } from '@playwright/test';

// BASE_URL set → test a deployed site (e.g. production). Unset → build + preview locally.
const baseURL = process.env.BASE_URL ?? 'http://localhost:4173';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL, viewport: { width: 1280, height: 720 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.BASE_URL
    ? undefined
    : { command: 'pnpm preview --port 4173 --strictPort', url: baseURL, reuseExistingServer: !process.env.CI },
});
