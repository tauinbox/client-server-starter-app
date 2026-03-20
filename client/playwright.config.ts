import { defineConfig, devices } from '@playwright/test';

const port = process.env['E2E_PORT'] || '4200';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 4 : undefined,
  reporter: process.env['CI']
    ? [['dot'], ['html', { open: 'never' }]]
    : 'html',
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
      command: `npx ng serve --host 127.0.0.1 --port ${port}`,
      url: baseURL,
      reuseExistingServer: !process.env['CI']
    }
  ]
});
