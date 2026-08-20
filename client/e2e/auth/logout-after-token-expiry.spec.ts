import { expect, loginViaUi, test } from '../fixtures/base.fixture';

// Regression: `logout()` used to POST /auth/logout with whatever access token
// the tab held, so a stale one got a 401 and the refresh token kept minting
// sessions behind a logged-out UI.
test.describe('Logout after the access token has gone stale', () => {
  test('refreshes first so the server drops the refresh token', async ({
    _mockServer,
    page
  }) => {
    // Before any navigation, so the page still loads on a running clock.
    await page.clock.install();

    const userId = '100';
    await loginViaUi(page, _mockServer.url, { id: userId, roles: ['admin'] });

    const loggedIn = await _mockServer.getState();
    expect(loggedIn.refreshTokens).toBe(1);

    const logoutStatuses: number[] = [];
    page.on('response', (resp) => {
      if (resp.url().endsWith('/api/v1/auth/logout')) {
        logoutStatuses.push(resp.status());
      }
    });

    // The mock compares `iat < tokenRevokedAt / 1000`, so the revocation and the
    // refresh after it must land on different seconds - see
    // reactive-token-refresh.spec.ts.
    await waitForNextSecondBoundary();
    await _mockServer.invalidateAccessTokens(userId);
    await waitForNextSecondBoundary();

    // The laptop lid closes for two hours: the clock jumps, the refresh timer
    // never runs.
    await page.clock.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);

    await page.getByRole('button', { name: /John Doe/i }).click();
    await page.getByRole('menuitem', { name: /Logout/i }).click();
    await expect(page).toHaveURL(/\/login\b/);

    expect(logoutStatuses).toEqual([200]);

    // Gone as an active token and as a rotated one kept for reuse detection.
    const loggedOut = await _mockServer.getState();
    expect(loggedOut.refreshTokens).toBe(0);
    expect(loggedOut.revokedRefreshTokens).toBe(0);
  });
});

function waitForNextSecondBoundary(): Promise<void> {
  const ms = Date.now() % 1000;
  return new Promise((resolve) => setTimeout(resolve, 1000 - ms + 50));
}
