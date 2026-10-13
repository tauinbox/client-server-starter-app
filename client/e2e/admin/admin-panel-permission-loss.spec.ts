import { expect, loginViaUiKeepSse, test } from '../fixtures/base.fixture';

// The route guard runs only on navigation, so a permission loss inside /admin
// (a `permissions_updated` push) must redirect from AdminPanelComponent.
test.describe('Admin panel — auto-redirect on permission loss (BKL-013)', () => {
  test('admin on /admin is booted to /forbidden when SSE strips their role', async ({
    _mockServer,
    page
  }) => {
    // The base fixture stubs /notifications/stream with an empty body. For
    // this test we need the real SSE pipe — drop the stub so requests fall
    // through to the general /api/* handler that rewrites the URL to
    // mock-server's worker port.
    await page.unroute(/\/api\/.*\/notifications\/stream/);

    const userId = '100';
    await loginViaUiKeepSse(page, _mockServer.url, {
      id: userId,
      roles: ['admin']
    });

    await page.goto('/admin');
    // Confirm we landed on /admin (a tab nav is present).
    await expect(page).toHaveURL(/\/admin\b/);

    // Tokens stay valid, so the user goes to /forbidden, not to /login.
    await _mockServer.changeUserRoles(userId, []);

    await expect(page).toHaveURL(/\/forbidden\b/, { timeout: 15_000 });
  });
});
