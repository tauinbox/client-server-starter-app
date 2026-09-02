import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import { MOCK_TOTP_CODE } from '../../../mock-server/src/constants';

const PASSWORD = 'Password1';

/**
 * The mock reads MFA_REQUIRED_FOR_ADMINS on every request, exactly as the
 * server reads its own configuration, and it runs in this worker process. The
 * flag is therefore set here and removed again, so no other file inherits it.
 */
test.beforeEach(() => {
  process.env['MFA_REQUIRED_FOR_ADMINS'] = 'true';
});

test.afterEach(() => {
  delete process.env['MFA_REQUIRED_FOR_ADMINS'];
});

test.describe('two-factor requirement for an administrator', () => {
  test('holds the administration surface shut until the enrolment is done', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    await expect(page).toHaveURL(/\/profile/);
    await expect(
      page.getByRole('alert').filter({ hasText: 'Two-factor authentication' })
    ).toBeVisible();

    // The entry point is hidden, not merely denied.
    await expect(page.getByRole('link', { name: 'Admin Panel' })).toHaveCount(
      0
    );

    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/profile/);

    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Authentication code').fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByRole('button', { name: 'I saved them' }).click();

    await expect(
      page
        .locator('nxs-two-factor')
        .getByText('Two-factor authentication is on')
    ).toBeVisible();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Two-factor authentication is required' })
    ).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Admin Panel' })).toBeVisible();

    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/admin\/users/);
  });

  test('leaves an account without an administrator role alone', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['user'] });

    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Two-factor authentication is required' })
    ).toHaveCount(0);
  });
});
