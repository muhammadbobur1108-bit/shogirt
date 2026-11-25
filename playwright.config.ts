import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
