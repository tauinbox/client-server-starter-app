import { expect, loginViaUi, test } from '../fixtures/base.fixture';

// Changing password from /auth/profile must require the user's current
// password. Without it (or with a wrong one) the request must fail with a
// 400 carrying errors.auth.invalidCurrentPassword.
test.describe('Profile password change', () => {
  test('should reject password change with no current password', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('New Password (Optional)').fill('NewPassword1');
    await page.getByLabel('Confirm New Password').fill('NewPassword1');

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

    await page.getByLabel('New Password (Optional)').fill('NewPassword1');
    await page.getByLabel('Current Password').fill('WrongPass1');
    await page.getByLabel('Confirm New Password').fill('NewPassword1');
    await page.getByLabel('First Name').click(); // blur

    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // mock-server returns 400 with errorKey errors.auth.invalidCurrentPassword,
    // which the error interceptor surfaces in the in-page error banner.
    await expect(page.locator('.error-message')).toBeVisible();
    await expect(page.locator('.error-message')).toContainText(
      /current password/i
    );
  });

  test('should accept password change with correct current password', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    // Current Password field only appears once the user starts typing a new password.
    await page.getByLabel('New Password (Optional)').fill('NewPassword1');
    await page.getByLabel('Current Password').fill('Password1');
    await page.getByLabel('Confirm New Password').fill('NewPassword1');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText('Profile updated successfully')).toBeVisible();
  });

  test('should hide currentPassword field when new password is blank', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await expect(page.getByLabel('Current Password')).not.toBeVisible();

    await page.getByLabel('New Password (Optional)').fill('NewPassword1');
    await expect(page.getByLabel('Current Password')).toBeVisible();

    await page.getByLabel('New Password (Optional)').clear();
    await expect(page.getByLabel('Current Password')).not.toBeVisible();
  });
});
