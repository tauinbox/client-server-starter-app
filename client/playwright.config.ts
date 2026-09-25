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
  use: {
    baseURL,
    trace: 'on-first-retry',
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
