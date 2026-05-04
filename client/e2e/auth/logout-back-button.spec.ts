import { expect, loginViaUi, test } from '../fixtures/base.fixture';

// Regression for the post-logout history-stack hazard. Browsers cache the
// last rendered HTML, so a user who clicks Logout and then presses Back will
// see the protected page reappear from the bfcache. Without an authenticated
// session it must NOT remain interactive — the route guard must redirect to
// /login on activation.
//
// Given a user logs in and visits a protected route,
// when they log out and press the browser Back button,
// then the next render must redirect to /login (no stale in-memory state,
// no usable protected UI).
test.describe('Logout + browser Back navigation', () => {
  test('back navigation after logout redirects to /login', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    // Visit a protected page so it lands in the back/forward cache.
    await page.goto('/users');
    await expect(page).toHaveURL(/\/users\b/);

    // Open the user menu and click Logout. The auth service navigates to
    // /login after the server-side logout call resolves.
    await page.getByRole('button', { name: /John Doe/i }).click();
    await page.getByRole('menuitem', { name: /Logout/i }).click();
    await expect(page).toHaveURL(/\/login\b/);

    // Browser Back. The protected /users entry is still in history, but the
    // session is gone — the auth route guard must redirect to /login.
    await page.goBack();
    await expect(page).toHaveURL(/\/login\b/);
  });
});
