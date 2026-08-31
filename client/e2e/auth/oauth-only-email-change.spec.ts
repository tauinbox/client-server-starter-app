import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import { createMockUser } from '../fixtures/mock-data';

// An account created through a provider holds no password. It used to be told
// to set one before changing its email, and the form that would have set it
// rejected the request for the same missing field. The change is now authorized
// by a step-up proof a provider round trip mints. The mock has no such round
// trip, so __control seeds the proof, as it does the OAuth exchange payload.
test.describe('OAuth-only account changes its email', () => {
  const userId = '200';
  const email = 'provider-only@example.com';

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

    await mockServer.seedOAuthAccounts(userId, [
      {
        provider: 'google',
        providerId: 'g-200',
        createdAt: '2025-01-01T00:00:00.000Z'
      }
    ]);
  }

  test('asks for the provider instead of a current password', async ({
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

    const emailField = page.getByLabel('Email', { exact: true });
    await expect(emailField).toHaveValue(email);

    await emailField.fill('new-address@example.com');

    // The current-password field is what used to appear here, and it is the
    // field this account can never fill.
    await expect(
      page.getByLabel('Current Password', { exact: true })
    ).toHaveCount(0);
    await expect(page.getByText(/confirm it is you/i).first()).toBeVisible();
  });

  test('completes the change once a provider proof is present', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: userId,
      email,
      roles: ['user']
    });
    await seedOAuthOnlyUser(_mockServer);

    // Stand in for the provider round trip: the server would set this cookie
    // at the end of it, on the auth path.
    const { token } = await _mockServer.issueReauthProof(userId);
    await page.context().addCookies([
      {
        name: 'reauth_proof',
        value: token,
        domain: 'localhost',
        path: '/api/v1/auth'
      }
    ]);

    // Seed before the document runs: `page.goto` resolves on load, while
    // Angular bootstraps after it, so writing the key from the test can land
    // after the component has already read and cleared it.
    await page.addInitScript(() =>
      sessionStorage.setItem('pending_email_change', 'new-address@example.com')
    );
    await page.goto('/profile?reauth=ok');

    await expect(
      page.getByText(/confirmation link sent/i).first()
    ).toBeVisible();

    const state = (await _mockServer.getState()) as {
      users: { id: string; email: string }[];
    };
    // The address does not change until the link is confirmed.
    expect(state.users.find((u) => u.id === userId)?.email).toBe(email);
  });

  test('refuses the change when no proof was minted', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: userId,
      email,
      roles: ['user']
    });
    await seedOAuthOnlyUser(_mockServer);

    await page.addInitScript(() =>
      sessionStorage.setItem('pending_email_change', 'new-address@example.com')
    );
    await page.goto('/profile?reauth=ok');

    await expect(
      page.getByText(/confirm it is you with your sign-in provider/i).first()
    ).toBeVisible();
  });
});
