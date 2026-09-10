import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import { createMockUser } from '../fixtures/mock-data';
import { STEP_UP_OPERATION } from '@app/shared/constants';

// An account with no password and one linked provider must not be able to
// strand itself with no way to authenticate. The route demands a step-up
// first, so it reaches that refusal only on the load after a round trip.
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
      createMockUser({
        id: userId,
        email,
        firstName: 'John',
        lastName: 'Doe',
        // Null, not empty: this is what an account created through a
        // provider actually holds, and the guard reads it that way.
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

    // Attach a single OAuth account — the only remaining auth path.
    await _mockServer.seedOAuthAccounts(userId, [
      {
        provider: 'google',
        providerId: 'g-12345',
        createdAt: '2025-01-01T00:00:00.000Z'
      }
    ]);

    // The proof this account earned at its provider. Without it the unlink is
    // refused for the step-up rather than for the last-provider rule.
    const { token } = await _mockServer.issueReauthProof(
      userId,
      STEP_UP_OPERATION.OAUTH_UNLINK
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
      sessionStorage.setItem('pending_oauth_unlink', 'google')
    );

    await page.goto('/profile?reauth=ok');

    const googleRow = page
      .locator('.oauth-provider-row')
      .filter({ hasText: 'Google' });
    const disconnectButton = googleRow.getByRole('button', {
      name: /^Disconnect$/i
    });

    // The server returns 400 with errorKey auth.unlinkLastProvider. Profile's
    // disconnect handler renders `err.error.message` in a snackbar. Use
    // getByText (snackbar text is the most uniquely-identifiable thing on
    // screen) — locating the container directly trips strict mode when an
    // unrelated snackbar from earlier in the suite is still mid-exit.
    await expect(
      page.getByText(/only way you can sign in/i).first()
    ).toBeVisible();

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
