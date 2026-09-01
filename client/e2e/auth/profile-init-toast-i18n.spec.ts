import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import { createMockUser } from '../fixtures/mock-data';

const userId = '200';
const email = 'provider-only@example.com';

// The two notifications the profile page raises on init run in `ngOnInit`,
// which is before the lazily fetched `auth` translation scope arrives. A
// `translate()` call that early answers with the key itself, so the user reads
// `auth.profile.emailChangeInitiated` instead of a sentence. Delaying the scope
// file widens that window enough to assert on.
test.describe('Profile init notifications wait for their translations', () => {
  test('states the outcome in words when the auth scope arrives late', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: userId,
      email,
      roles: ['user']
    });

    await _mockServer.seedUsers([
      createMockUser({
        id: userId,
        email,
        firstName: 'Pat',
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
    await _mockServer.seedOAuthAccounts(userId, [
      {
        provider: 'google',
        providerId: 'g-200',
        createdAt: '2025-01-01T00:00:00.000Z'
      }
    ]);

    const { token } = await _mockServer.issueReauthProof(userId);
    await page.context().addCookies([
      {
        name: 'reauth_proof',
        value: token,
        domain: 'localhost',
        path: '/api/v1/auth'
      }
    ]);

    await page.addInitScript(() =>
      sessionStorage.setItem('pending_email_change', 'new-address@example.com')
    );

    await page.route(/features\/auth\/i18n\/en\.json/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue();
    });

    await page.goto('/profile?reauth=ok');

    await expect(
      page.getByText('auth.profile.emailChangeInitiated')
    ).toHaveCount(0);
    await expect(page.getByText(/confirmation link sent/i).first()).toBeVisible(
      {
        timeout: 15_000
      }
    );
  });
});
