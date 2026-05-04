import { expect, loginViaUiKeepSse, test } from '../fixtures/base.fixture';

// Regression for BKL-013. The route guard checks the OR-of-three admin
// permission set on navigation, but if the admin loses their privileges WHILE
// already inside /admin/* (e.g. another admin revokes their role and the SSE
// `permissions_updated` event fires), no further navigation happens, so the
// guard never re-runs. AdminPanelComponent owns the live re-evaluation: when
// the signal flips false, navigate to /forbidden so the user is not left
// staring at an admin tab they can no longer act on.
//
// Given an admin is sitting on /admin,
// when their role is revoked server-side and the SSE event fires,
// then the page must auto-redirect to /forbidden — no click, no reload.
test.describe('Admin panel — auto-redirect on permission loss (BKL-013)', () => {
  test('admin on /admin is booted to /forbidden when SSE strips their role', async ({
    _mockServer,
    page
  }) => {
    // The base fixture stubs /notifications/stream with an empty body so
    // loginViaUi's networkidle wait can settle. For this test we need the
    // real SSE pipe — drop the stub so requests fall through to the general
    // /api/* handler that rewrites the URL to mock-server's worker port.
    await page.unroute(/\/api\/.*\/notifications\/stream/);

    const userId = '100';
    await loginViaUiKeepSse(page, _mockServer.url, {
      id: userId,
      roles: ['admin']
    });

    await page.goto('/admin');
    // Confirm we landed on /admin (a tab nav is present).
    await expect(page).toHaveURL(/\/admin\b/);

    // Server-side: drop the user's roles and push the SSE event WITHOUT
    // revoking tokens. The client's NotificationsService delivers
    // `permissions_updated` over the open stream; AuthService re-fetches
    // permissions; the new (empty) ability flips canAccessAdmin to false;
    // the AdminPanelComponent effect navigates to /forbidden. Tokens stay
    // valid so the user is not booted to /login — that's the BKL-013 fix.
    await _mockServer.changeUserRoles(userId, []);

    await expect(page).toHaveURL(/\/forbidden\b/, { timeout: 15_000 });
  });
});
