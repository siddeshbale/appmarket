import { defineConfig } from '@playwright/test';

// Uses an installed Chrome by default (no browser download). On machines without Chrome:
//   npx playwright install chromium   and run with E2E_CHANNEL=chromium
const port = Number(process.env.E2E_PORT ?? 5199);
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.E2E_CHANNEL === 'chromium' ? undefined : (process.env.E2E_CHANNEL ?? 'chrome'),
    headless: true,
  },
  webServer: {
    command: 'npx tsx e2e/serve.ts',
    url: `http://127.0.0.1:${port}/api/meta`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
