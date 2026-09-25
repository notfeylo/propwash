import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Flight Lab tests simulate tens of seconds at 1 kHz; CI runners need more than the 5 s default.
  test: { include: ['tests/unit/**/*.test.ts'], testTimeout: 120_000 },
});
