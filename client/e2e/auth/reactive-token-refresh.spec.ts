import {
  expect,
  loginViaUi,
  test,
  type MockServerApi
} from '../fixtures/base.fixture';

// Regression for the reactive token-refresh path. Fixes the gap where a user
// whose access token has just been invalidated (server-side revocation, near
// expiry, etc.) makes a normal API call and the JWT interceptor must
// (1) catch the 401, (2) hit /auth/refresh-token with the still-valid
// HttpOnly refresh cookie, (3) replay the original request — all without the
// user noticing.
//
// Given a user is logged in,
// when the server invalidates their existing access tokens (without revoking
// refresh) and the user navigates to a page that triggers an API call,
// then the page must render normally because the interceptor refreshed and
// retried — no /login redirect, no error UI.
test.describe('Reactive access-token refresh', () => {
  test('401 → refresh → retry succeeds with no user-visible interruption', async ({
    _mockServer,
    page
  }) => {
    const userId = '100';
    await loginViaUi(page, _mockServer.url, {
      id: userId,
      roles: ['admin']
    });

    // Capture every refresh-token response status — proves the interceptor
    // actually refreshed rather than the original call somehow succeeding.
    const refreshStatuses: number[] = [];
    page.on('response', (resp) => {
      if (resp.url().includes('/api/v1/auth/refresh-token')) {
        refreshStatuses.push(resp.status());
      }
    });

    // Invalidate the user's access tokens. Refresh cookie stays valid so the
    // refresh-and-retry loop can succeed.
    await invalidateAfterIatBoundary(_mockServer, userId);

    // Navigate to a list page that fires GET /api/v1/users (admin-only).
    // The first request returns 401 because the access token is now revoked;
    // the JWT interceptor retries after refreshing and the page renders.
    await page.goto('/users');

    // Asserting on the card title is more robust than a specific user cell
    // (mock-server seeds 70 users, sort order is createdAt-desc, and the
    // well-known admin@example.com seed has an old createdAt that puts it on
    // the last page). The title is a `mat-card-title` (not an ARIA heading)
    // so we match it by text. Confirms the user list loaded successfully for
    // an authenticated admin.
    await expect(
      page.getByText('User Management', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: /@example\.com$/ }).first()
    ).toBeVisible();

    // The user is still on /users — no logout-redirect to /login.
    await expect(page).toHaveURL(/\/users\b/);

    // At least one successful refresh round-trip happened. Multiple is fine
    // (parallel calls each trip the interceptor) — at least one must succeed.
    expect(refreshStatuses).toContain(200);
  });
});

// Mock-server compares `decoded.iat < tokenRevokedAt/1000`. JWT `iat` is
// whole-second precision; `tokenRevokedAt` is ms precision. So even after a
// fresh refresh, the new token's `iat` could equal the integer second of
// `tokenRevokedAt` and stay rejected. To make the test deterministic without
// racing the clock:
//   1. wait until the next second boundary, THEN invalidate (so the existing
//      token's iat is strictly less than tokenRevokedAt's second);
//   2. wait again until the NEXT second boundary, so any refresh-issued
//      token's iat is strictly greater than tokenRevokedAt's second and
//      passes the auth check.
async function invalidateAfterIatBoundary(
  mockServer: MockServerApi,
  userId: string
): Promise<void> {
  await waitForNextSecondBoundary();
  await mockServer.invalidateAccessTokens(userId);
  await waitForNextSecondBoundary();
}

function waitForNextSecondBoundary(): Promise<void> {
  const ms = Date.now() % 1000;
  return new Promise((resolve) => setTimeout(resolve, 1000 - ms + 50));
}
