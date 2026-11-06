import type { Page } from '@playwright/test';
import {
  expect,
  loginViaUi,
  routeApiToMockServer,
  test,
  type MockServerApi
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

    await page.getByLabel('New password (optional)').fill('Quartz-Meadow-77');
    await page.getByLabel('Confirm new password').fill('Quartz-Meadow-77');

    // currentPassword field is now visible (rendered when new password entered).
    // Submit with it left empty — form-level validation must keep submit disabled.
    await expect(page.getByLabel('Current password')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Save', exact: true })
    ).toBeDisabled();
  });

  test('should reject password change with wrong current password', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('New password (optional)').fill('Quartz-Meadow-77');
    await page.getByLabel('Current password').fill('WrongPass1');
    await page.getByLabel('Confirm new password').fill('Quartz-Meadow-77');
    await page.getByLabel('Full name').click(); // blur

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
    await expect(otherTab.getByLabel('Full name')).toBeVisible();

    // Current password field only appears once the user starts typing a new password.
    await page.getByLabel('New password (optional)').fill('Quartz-Meadow-77');
    await page.getByLabel('Current password').fill('Password1');
    await page.getByLabel('Confirm new password').fill('Quartz-Meadow-77');
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

  // A provider that someone else linked while knowing the old password would
  // keep signing in, so the new password offers to disconnect them, checked.
  test.describe('linked providers', () => {
    type ControlState = {
      oauthAccounts: Record<string, { provider: string }[]>;
    };

    // The id that loginViaUi gives the user it signs in.
    const userId = '100';

    async function signInWithGoogleLinked(
      page: Page,
      mockServer: MockServerApi
    ): Promise<void> {
      await loginViaUi(page, mockServer.url);
      await mockServer.seedOAuthAccounts(userId, [
        {
          provider: 'google',
          providerId: 'g-intruder',
          createdAt: '2026-10-01T10:00:00.000Z'
        }
      ]);
      await page.reload();
      await expect(page.getByText(/Connected on/)).toBeVisible();
    }

    async function changePassword(
      page: Page,
      { keepProviders }: { keepProviders: boolean }
    ): Promise<void> {
      await page.getByLabel('New password (optional)').fill('Quartz-Meadow-77');
      await page.getByLabel('Current password').fill('Password1');
      await page.getByLabel('Confirm new password').fill('Quartz-Meadow-77');

      const box = page.getByRole('checkbox', {
        name: 'Also disconnect Google'
      });

      await expect(box).toBeChecked();

      if (keepProviders) await box.uncheck();

      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page).toHaveURL(/\/login\?password_changed=1$/);
    }

    test('disconnects them by default', async ({ _mockServer, page }) => {
      await signInWithGoogleLinked(page, _mockServer);

      await changePassword(page, { keepProviders: false });

      const state = (await _mockServer.getState()) as ControlState;

      expect(state.oauthAccounts[userId] ?? []).toHaveLength(0);
    });

    test('keeps them when the owner clears the box', async ({
      _mockServer,
      page
    }) => {
      await signInWithGoogleLinked(page, _mockServer);

      await changePassword(page, { keepProviders: true });

      const state = (await _mockServer.getState()) as ControlState;

      expect(state.oauthAccounts[userId]).toHaveLength(1);
    });
  });

  test('should hide currentPassword field when new password is blank', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await expect(page.getByLabel('Current password')).not.toBeVisible();

    await page.getByLabel('New password (optional)').fill('Quartz-Meadow-77');
    await expect(page.getByLabel('Current password')).toBeVisible();

    await page.getByLabel('New password (optional)').clear();
    await expect(page.getByLabel('Current password')).not.toBeVisible();
  });
});
