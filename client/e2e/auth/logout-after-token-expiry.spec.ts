import { expect, loginViaUi, test } from '../fixtures/base.fixture';

// Regression for the logout that never reached the server. `logout()` decided
// whether to call the API from the presence of an access token, so a tab whose
// token had gone stale POSTed /auth/logout with a token the server rejects: the
// UI emptied, the toast stayed silent, and the refresh token kept minting
// sessions until its own expiry.
//
// Given a tab that slept past its access token's lifetime (the wall clock jumps
// forward without the scheduled refresh ever firing, and the server no longer
// accepts the token the tab still holds),
// when the user clicks Logout,
// then the client refreshes first and the logout the server accepts leaves no
// refresh token behind.
test.describe('Logout after the access token has gone stale', () => {
  test('refreshes first so the server drops the refresh token', async ({
    _mockServer,
    page
  }) => {
    // Installed before any navigation so the page loads on a running clock; the
    // jump comes later, once the session is established.
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

    // The mock compares `decoded.iat < tokenRevokedAt / 1000` at whole-second
    // precision, so the revocation and the refresh that follows it must land on
    // different seconds - see reactive-token-refresh.spec.ts.
    await waitForNextSecondBoundary();
    await _mockServer.invalidateAccessTokens(userId);
    await waitForNextSecondBoundary();

    // The laptop lid closes for two hours: `Date.now()` jumps, the refresh timer
    // never runs, and the tab wakes up holding a token nobody accepts.
    await page.clock.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);

    await page.getByRole('button', { name: /John Doe/i }).click();
    await page.getByRole('menuitem', { name: /Logout/i }).click();
    await expect(page).toHaveURL(/\/login\b/);

    expect(logoutStatuses).toEqual([200]);

    // The credential that outlived the old logout: gone from the server, both
    // as an active token and as a rotated one kept for reuse detection.
    const loggedOut = await _mockServer.getState();
    expect(loggedOut.refreshTokens).toBe(0);
    expect(loggedOut.revokedRefreshTokens).toBe(0);
  });
});

function waitForNextSecondBoundary(): Promise<void> {
  const ms = Date.now() % 1000;
  return new Promise((resolve) => setTimeout(resolve, 1000 - ms + 50));
}
