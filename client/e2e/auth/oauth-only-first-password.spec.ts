import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import { createMockUser } from '../fixtures/mock-data';
import { STEP_UP_OPERATION } from '@app/shared/constants';

// A password outlives the session that set it, so an account created through a
// provider now proves itself before it binds one. The mock has no round trip,
// so __control seeds the proof the callback would have minted.
test.describe('OAuth-only account sets its first password', () => {
  const userId = '210';
  const email = 'first-password@example.com';
  const newPassword = 'Sunrise-Kettle-19';

  async function seedOAuthOnlyUser(mockServer: {
    seedUsers: (users: ReturnType<typeof createMockUser>[]) => Promise<void>;
    seedOAuthAccounts: (
      userId: string,
      accounts: { provider: string; providerId: string; createdAt: string }[]
    ) => Promise<void>;
  }): Promise<void> {
    await mockServer.seedUsers([
      createMockUser({
        id: userId,
        email,
        firstName: 'Robin',
        lastName: 'Provider',
        password: null,
        isActive: true,
        roles: ['user'],
        isEmailVerified: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        tokenRevokedAt: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        deletedAt: null
      })
    ]);

    await mockServer.seedOAuthAccounts(userId, [
      {
        provider: 'google',
        providerId: 'g-210',
        createdAt: '2025-01-01T00:00:00.000Z'
      }
    ]);
  }

  test('announces the provider round trip instead of a current password', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: userId,
      email,
      roles: ['user']
    });
    await seedOAuthOnlyUser(_mockServer);

    await page.goto('/profile');

    await page
      .getByLabel('New Password (Optional)', { exact: true })
      .fill(newPassword);

    // The field this account can never fill.
    await expect(
      page.getByLabel('Current Password', { exact: true })
    ).toHaveCount(0);
    await expect(page.getByText(/confirm it is you/i).first()).toBeVisible();
  });

  test('binds the password once a provider proof is present', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: userId,
      email,
      roles: ['user']
    });
    await seedOAuthOnlyUser(_mockServer);

    // Stands in for the provider round trip, bound to the operation.
    const { token } = await _mockServer.issueReauthProof(
      userId,
      STEP_UP_OPERATION.PASSWORD_SET
    );
    await page.context().addCookies([
      {
        name: 'reauth_proof',
        value: token,
        domain: 'localhost',
        path: '/api/v1/auth'
      }
    ]);

    // Seed before the document runs: the component reads and clears the key
    // during bootstrap, which happens after `page.goto` resolves.
    await page.addInitScript(() =>
      sessionStorage.setItem('pending_password_set', 'true')
    );

    await page.goto('/profile?reauth=ok');

    // A credential never enters web storage, so the page asks for it again.
    await expect(
      page.getByText(/enter your new password/i).first()
    ).toBeVisible({ timeout: 10_000 });

    await page
      .getByLabel('New Password (Optional)', { exact: true })
      .fill(newPassword);
    await page
      .getByLabel('Confirm New Password', { exact: true })
      .fill(newPassword);

    const saved = page.waitForResponse(
      (res) =>
        res.url().includes('/auth/profile') &&
        res.request().method() === 'PATCH' &&
        res.status() === 200,
      { timeout: 15_000 }
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await saved;
  });

  test('refuses a proof taken for the email change', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: userId,
      email,
      roles: ['user']
    });
    await seedOAuthOnlyUser(_mockServer);

    const { token } = await _mockServer.issueReauthProof(
      userId,
      STEP_UP_OPERATION.EMAIL_CHANGE
    );
    await page.context().addCookies([
      {
        name: 'reauth_proof',
        value: token,
        domain: 'localhost',
        path: '/api/v1/auth'
      }
    ]);
    await page.addInitScript(() =>
      sessionStorage.setItem('pending_password_set', 'true')
    );

    await page.goto('/profile?reauth=ok');
    await expect(
      page.getByText(/enter your new password/i).first()
    ).toBeVisible({ timeout: 10_000 });

    await page
      .getByLabel('New Password (Optional)', { exact: true })
      .fill(newPassword);
    await page
      .getByLabel('Confirm New Password', { exact: true })
      .fill(newPassword);

    const refused = page.waitForResponse(
      (res) =>
        res.url().includes('/auth/profile') &&
        res.request().method() === 'PATCH' &&
        res.status() === 400,
      { timeout: 15_000 }
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await refused;
  });
});
