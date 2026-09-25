import { expect, loginViaUi, test } from '../fixtures/base.fixture';

/**
 * Regression: these pages show a refused request themselves, and the global
 * error interceptor showed the same refusal again in a snackbar. The snackbar
 * opens synchronously in the interceptor, before the page handles the error,
 * so it is already in the DOM when the in-page message renders.
 */
test.describe('A refused request shows one error message', () => {
  test('a failed OAuth data exchange shows only the login form error', async ({
    // Requested only so that `/api` reaches the mock server.
    _mockServer,
    page
  }) => {
    // No `oauth_data` cookie, so the exchange is refused.
    await page.goto('/oauth/callback');

    await expect(page).toHaveURL(/\/login\?oauth_error=auth_failed/);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'OAuth authentication failed. Please try again.'
    );
    await expect(page.locator('mat-snack-bar-container')).toHaveCount(0);
  });

  test('a wrong current password shows only the profile error', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('New Password (Optional)').fill('Quartz-Meadow-77');
    await page.getByLabel('Current Password').fill('WrongPass1');
    await page.getByLabel('Confirm New Password').fill('Quartz-Meadow-77');
    await page.getByLabel('First Name').click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.locator('.error-message')).toHaveText(
      /current password is incorrect/i
    );
    await expect(page.locator('mat-snack-bar-container')).toHaveCount(0);
  });
});
