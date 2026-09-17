import {
  expect,
  loginViaUi,
  routeApiToMockServer,
  test
} from '../fixtures/base.fixture';

// Changing password from /auth/profile must require the user's current
// password. Without it (or with a wrong one) the request must fail with a
// 400 carrying errors.auth.invalidCurrentPassword.
test.describe('Profile password change', () => {
  test('should reject password change with no current password', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('New Password (Optional)').fill('Quartz-Meadow-77');
    await page.getByLabel('Confirm New Password').fill('Quartz-Meadow-77');

    // currentPassword field is now visible (rendered when new password entered).
    // Submit with it left empty — form-level validation must keep submit disabled.
    await expect(page.getByLabel('Current Password')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Save', exact: true })
    ).toBeDisabled();
  });

  test('should reject password change with wrong current password', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('New Password (Optional)').fill('Quartz-Meadow-77');
    await page.getByLabel('Current Password').fill('WrongPass1');
    await page.getByLabel('Confirm New Password').fill('Quartz-Meadow-77');
    await page.getByLabel('First Name').click(); // blur

    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // mock-server returns 400 with errorKey errors.auth.invalidCurrentPassword,
    // which the error interceptor surfaces in the in-page error banner.
    await expect(page.locator('.error-message')).toBeVisible();
    await expect(page.locator('.error-message')).toContainText(
      /current password/i
    );
  });

  // The server revokes every session on a password change, so the page must
  // not stay on a dead token until the next request drops the user silently.
  test('ends the session in every tab and says why on the login page', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    const otherTab = await page.context().newPage();
    await routeApiToMockServer(otherTab, _mockServer.url);
    await otherTab.goto('/profile');
    await expect(otherTab.getByLabel('First Name')).toBeVisible();

    // Current Password field only appears once the user starts typing a new password.
    await page.getByLabel('New Password (Optional)').fill('Quartz-Meadow-77');
    await page.getByLabel('Current Password').fill('Password1');
    await page.getByLabel('Confirm New Password').fill('Quartz-Meadow-77');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page).toHaveURL(/\/login\?password_changed=1$/);
    await expect(
      page.getByText(
        'Your password was changed and every session was ended. Sign in with the new password.'
      )
    ).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem('auth_user'))
    ).toBeNull();

    // The other tab stays quiet on /profile, so only the storage event can move it.
    await expect(otherTab).toHaveURL(/\/login\b/);
    await otherTab.close();
  });

  test('should hide currentPassword field when new password is blank', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await expect(page.getByLabel('Current Password')).not.toBeVisible();

    await page.getByLabel('New Password (Optional)').fill('Quartz-Meadow-77');
    await expect(page.getByLabel('Current Password')).toBeVisible();

    await page.getByLabel('New Password (Optional)').clear();
    await expect(page.getByLabel('Current Password')).not.toBeVisible();
  });
});
