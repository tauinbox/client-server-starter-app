import { expect, loginViaUi, test } from '../fixtures/base.fixture';

// A session has an absolute lifetime: rotation keeps the session id, so the
// refresh window alone never ends a device that refreshes on schedule. Past the
// cap the refresh answers 401, and the client must land the user on /login
// instead of looping on the refresh call.
test.describe('Absolute session lifetime', () => {
  test('an aged session lands the user on the login page', async ({
    _mockServer,
    page
  }) => {
    const userId = '100';
    await loginViaUi(page, _mockServer.url, { id: userId, roles: ['admin'] });

    const refreshStatuses: number[] = [];
    page.on('response', (resp) => {
      if (resp.url().includes('/api/v1/auth/refresh-token')) {
        refreshStatuses.push(resp.status());
      }
    });

    // The mock compares `iat < tokenRevokedAt / 1000`, so the revocation and
    // the request after it must land on different seconds - see
    // reactive-token-refresh.spec.ts.
    await waitForNextSecondBoundary();
    await _mockServer.invalidateAccessTokens(userId);
    await waitForNextSecondBoundary();

    // No test can wait 30 days out, so the session start moves instead.
    await _mockServer.ageSession(userId);

    // The list call answers 401, the interceptor refreshes, and the refresh is
    // refused for age.
    await page.goto('/users');

    await expect(page).toHaveURL(/\/login\b/);
    expect(refreshStatuses).toContain(401);
    expect(refreshStatuses).not.toContain(200);

    // Nothing of the session is left behind, so no reuse detection fires on a
    // later attempt with the same cookie.
    const state = await _mockServer.getState();
    expect(state.refreshTokens).toBe(0);
    expect(state.revokedRefreshTokens).toBe(0);
    expect(state.sessionStarts).toBe(0);

    // A raw translation key on screen is the failure mode of a server error key
    // the client does not translate.
    await expect(page.getByText(/errors\.auth\./)).toHaveCount(0);
  });
});

function waitForNextSecondBoundary(): Promise<void> {
  const ms = Date.now() % 1000;
  return new Promise((resolve) => setTimeout(resolve, 1000 - ms + 50));
}
