import {
  expect,
  expectNoSnackbar,
  loginViaUi,
  markOAuthRoundTripStarted,
  test
} from '../fixtures/base.fixture';
import { mockId } from '../fixtures/ids';

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
    // This tab started the round trip, but it holds no `oauth_data` cookie,
    // so the exchange is refused.
    await page.goto('/login');
    await markOAuthRoundTripStarted(page);
    await page.goto('/oauth/callback');

    await expect(page).toHaveURL(/\/login\?oauth_error=auth_failed/);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'OAuth authentication failed. Please try again.'
    );
    await expectNoSnackbar(page);
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
    await expectNoSnackbar(page);
  });

  test('a refused user save shows only the edit form error', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto(`/users/${mockId('user-3')}/edit`);

    // The address belongs to another seeded user, so the mock answers 409.
    await page.getByLabel('Email').fill('jane@example.com');
    await page.getByLabel('Email').blur();
    await page.getByLabel('Your current password').fill('Password1');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Change email' })
      .click();

    await expect(page.locator('.error-message')).toHaveText(
      'User with this email already exists'
    );
    await expectNoSnackbar(page);
  });
});
