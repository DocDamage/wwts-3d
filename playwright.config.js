import { defineConfig } from '@playwright/test';

// Browser smoke tests (npm run e2e). Uses the installed Microsoft Edge, or set
// PW_CHANNEL=chrome / PW_CHANNEL= (bundled Chromium after `npx playwright install`).
const channel = process.env.PW_CHANNEL ?? 'msedge';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    channel: channel || undefined,
    viewport: { width: 1366, height: 820 }
  },
  webServer: {
    command: 'npx vite --port 3100 --strictPort --open false',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    timeout: 120_000
  }
});
