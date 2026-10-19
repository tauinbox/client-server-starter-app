import type { Page } from '@playwright/test';
import { expect, loginViaUiKeepSse, test } from '../fixtures/base.fixture';
import { mockId } from '../fixtures/ids';

const assignEditorRole = async (
  mockServerUrl: string,
  userId: string
): Promise<void> => {
  const login = await fetch(`${mockServerUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'Password1'
    })
  });
  const { tokens } = (await login.json()) as {
    tokens: { access_token: string };
  };
  const assign = await fetch(`${mockServerUrl}/api/v1/roles/assign/${userId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens.access_token}`
    },
    body: JSON.stringify({ roleId: mockId('role-editor') })
  });
  expect(assign.status).toBe(201);
};

const streamOpened = (page: Page) =>
  page.waitForRequest((r) => r.url().includes('/api/v1/notifications/stream'));

// A role assignment ends every session of the user. The keep-alive check of
// the stream finds the session dead and sends `session_invalidated`; the client
// signs out and keeps the page it was on as the return URL.
test.describe('Sign-out on a role change', () => {
  const previousHeartbeat = process.env['MOCK_SSE_HEARTBEAT_MS'];

  test.beforeEach(() => {
    process.env['MOCK_SSE_HEARTBEAT_MS'] = '300';
  });

  test.afterEach(() => {
    if (previousHeartbeat === undefined) {
      delete process.env['MOCK_SSE_HEARTBEAT_MS'];
    } else {
      process.env['MOCK_SSE_HEARTBEAT_MS'] = previousHeartbeat;
    }
  });

  test('a role assignment signs the user out with the return URL', async ({
    _mockServer,
    page
  }) => {
    await page.unroute(/\/api\/.*\/notifications\/stream/);

    const userId = mockId('user-100');
    await loginViaUiKeepSse(page, _mockServer.url, { id: userId });
    await page.goto('/profile');
    // The address bar shows /profile before the router commits it.
    await expect(page.getByLabel('First name')).toBeVisible();

    await assignEditorRole(_mockServer.url, userId);

    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fprofile$/);
  });

  test('a sign-out before the first navigation ends keeps the return URL', async ({
    _mockServer,
    page
  }) => {
    await page.unroute(/\/api\/.*\/notifications\/stream/);

    const userId = mockId('user-100');
    await loginViaUiKeepSse(page, _mockServer.url, { id: userId });

    // Hold the profile chunk, so the first navigation of the reload stays
    // in progress while the stream delivers the sign-out.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\.js$/, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (body.includes('nxs-profile')) await held;
      await route.fulfill({ response, body });
    });

    const stream = streamOpened(page);
    await page.goto('/profile', { waitUntil: 'commit' });
    await stream;

    await assignEditorRole(_mockServer.url, userId);

    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fprofile$/);
    release();
  });

  test('a sign-out during the session restore keeps the return URL', async ({
    _mockServer,
    page
  }) => {
    await page.unroute(/\/api\/.*\/notifications\/stream/);

    const userId = mockId('user-100');
    await loginViaUiKeepSse(page, _mockServer.url, { id: userId });

    // Hold the permissions response, so the bootstrap initializer is still
    // running and the router has not started its first navigation.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/api\/v1\/auth\/permissions$/, async (route) => {
      await held;
      await route.continue();
    });

    const stream = streamOpened(page);
    await page.goto('/profile', { waitUntil: 'commit' });
    await stream;

    await assignEditorRole(_mockServer.url, userId);
    // The teardown removes the persisted user before the restore can finish.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('auth_user')))
      .toBeNull();
    release();

    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fprofile$/);
  });
});
