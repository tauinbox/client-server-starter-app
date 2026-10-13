import { expect, loginViaUiKeepSse, test } from '../fixtures/base.fixture';
import { mockId } from '../fixtures/ids';

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

    const login = await fetch(`${_mockServer.url}/api/v1/auth/login`, {
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
    const assign = await fetch(
      `${_mockServer.url}/api/v1/roles/assign/${userId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.access_token}`
        },
        body: JSON.stringify({ roleId: mockId('role-editor') })
      }
    );
    expect(assign.status).toBe(201);

    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fprofile$/);
  });
});
