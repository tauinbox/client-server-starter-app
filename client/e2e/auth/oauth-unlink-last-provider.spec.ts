import { expect, loginViaUi, test } from '../fixtures/base.fixture';

// Regression for the OAuth-only-account safety check. Server: /oauth/accounts
// /:provider DELETE rejects with `auth.unlinkLastProvider` when the user has
// no password set AND no other OAuth account remains, so the user cannot
// strand themselves with no way to authenticate. The mock-server mirrors
// this. Both paths must keep behaving so the user is never locked out.
//
// Given an OAuth-only account (no password) with exactly one linked provider,
// when the user clicks Disconnect on that provider,
// then the request must fail with the unlink-last-provider error and the
// provider must remain linked.
test.describe('OAuth — unlink last provider safety', () => {
  test('cannot unlink the only OAuth account when no password is set', async ({
    _mockServer,
    page
  }) => {
    const userId = '100';
    const email = 'oauth-only@example.com';

    // Login normally with a password so we can complete the credential flow.
    await loginViaUi(page, _mockServer.url, {
      id: userId,
      email,
      roles: ['user']
    });

    // Mutate the user to have no password — this is what an account created
    // exclusively via OAuth signup looks like. The server's unlink check is
    // gated on `!user.password && otherOAuth === 0`.
    await _mockServer.seedUsers([
      {
        id: userId,
        email,
        firstName: 'John',
        lastName: 'Doe',
        password: '',
        isActive: true,
        roles: ['user'],
        isEmailVerified: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        tokenRevokedAt: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        deletedAt: null
      }
    ]);

    // Attach a single OAuth account — the only remaining auth path.
    await _mockServer.seedOAuthAccounts(userId, [
      {
        provider: 'google',
        providerId: 'g-12345',
        createdAt: '2025-01-01T00:00:00.000Z'
      }
    ]);

    await page.goto('/profile');

    const googleRow = page
      .locator('.oauth-provider-row')
      .filter({ hasText: 'Google' });
    const disconnectButton = googleRow.getByRole('button', {
      name: /^Disconnect$/i
    });

    // Wait for OAuth accounts to load before clicking — the row exists with
    // a Connect button until /oauth/accounts resolves and re-renders.
    await expect(disconnectButton).toBeVisible();
    await disconnectButton.click();

    // The server returns 400 with errorKey auth.unlinkLastProvider. Profile's
    // disconnect handler renders `err.error.message` in a snackbar. Use
    // getByText (snackbar text is the most uniquely-identifiable thing on
    // screen) — locating the container directly trips strict mode when an
    // unrelated snackbar from earlier in the suite is still mid-exit.
    await expect(page.getByText(/last OAuth provider/i).first()).toBeVisible();

    // The Google account is still linked — Disconnect button persists,
    // there is no Connect button on this row. Use anchored regex so the match
    // doesn't accidentally include the Disconnect button (which contains the
    // substring "Connect" in its accessible name).
    await expect(disconnectButton).toBeVisible();
    await expect(
      googleRow.getByRole('button', { name: /^Connect$/i })
    ).toHaveCount(0);
  });
});
