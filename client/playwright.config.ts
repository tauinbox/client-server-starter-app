import { defineConfig, devices } from '@playwright/test';

const port = process.env['E2E_PORT'] || '4200';
const baseURL = `http://localhost:${port}`;
// A page route makes Playwright intercept every request, and the hundreds of
// unbundled `ng serve` modules then stall for seconds under a parallel run.
const useDevServer = process.env['E2E_DEV_SERVER'] === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 4 : undefined,
  reporter: process.env['CI'] ? [['dot'], ['html', { open: 'never' }]] : 'html',
  // A full parallel run keeps the CPU near 100%, and a starved renderer can
  // paint the first view after a navigation more than 5 s late.
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    // Local runs have no retry, so keep the trace of every failure.
    trace: process.env['CI'] ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    actionTimeout: 10_000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: [
    {
      command: useDevServer
        ? `npx ng serve --host 127.0.0.1 --port ${port}`
        : `npx serve -s dist/client/browser -l ${port}`,
      url: baseURL,
      // A cold `ng serve` (empty .angular/cache) can exceed Playwright's 60s default.
      timeout: 180_000,
      // Reusing a server on the port could silently pick up a stale build or a
      // dev server, so only the explicit dev-server mode reuses one.
      reuseExistingServer: useDevServer && !process.env['CI']
    }
  ]
});
