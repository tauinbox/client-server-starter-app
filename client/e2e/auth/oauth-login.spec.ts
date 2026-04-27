import { expect, test } from '../fixtures/base.fixture';

// BKL-005: when a local account already exists for the OAuth-asserted email,
// the server refuses to auto-link and redirects back with
// `?oauth_error=email_already_registered`. The login page must show the
// translated banner so users understand why login failed.
//
// Mock-server's OAuth endpoints are 501 stubs, so we simulate the server's
// redirect at the browser level via page.route(). The server-side throw +
// redirect mapping is covered by oauth.service.spec.ts and oauth.controller.spec.ts.

test.describe('OAuth login — auto-link disabled (BKL-005)', () => {
  test('shows email_already_registered banner when local account exists', async ({
    page,
    _mockServer
  }) => {
    // Intercept the Google OAuth init request and simulate the redirect chain
    // the real server emits when it detects the email is already taken locally.
    await page.route('**/api/v1/auth/oauth/google', (route) =>
      route.fulfill({
        status: 302,
        headers: {
          Location: '/login?oauth_error=email_already_registered'
        },
        body: ''
      })
    );

    await page.goto('/login');
    await page
      .getByRole('button', { name: /Google/ })
      .first()
      .click();

    await expect(page).toHaveURL(
      /\/login\?oauth_error=email_already_registered/
    );

    await expect(page.locator('.error-message')).toContainText(
      'already registered'
    );

    // No session is created — submit button stays for the credentials form.
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Login' })).toBeVisible();
  });

  test('navigating directly with oauth_error=email_already_registered renders banner', async ({
    page,
    _mockServer
  }) => {
    await page.goto('/login?oauth_error=email_already_registered');

    await expect(page.locator('.error-message')).toContainText(
      'already registered'
    );
  });
});
