import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import type { MockServerApi } from '../fixtures/base.fixture';
import { createMockUser } from '../fixtures/mock-data';
import { STEP_UP_OPERATION } from '@app/shared/constants';
import type { Page } from '@playwright/test';

// A linked provider signs the account in, and no recovery path removes it. The
// link route already demands a fresh proof of identity for that reason, and
// removing the row is the same credential change in the other direction: a
// stolen session must not be able to strip the owner of a sign-in method.
test.describe('Unlinking a provider demands a step-up', () => {
  const passwordUserId = '220';
  const passwordEmail = 'unlink-step-up@example.com';
  const providerUserId = '221';
  const providerEmail = 'unlink-provider-only@example.com';

  /** The row for a provider that is linked. */
  function disconnectButton(page: Page, provider: string) {
    return page
      .locator('.oauth-provider-row')
      .filter({ hasText: provider })
      .getByRole('button', { name: /^Disconnect$/i });
  }

  async function seedProviderOnlyUser(
    mockServer: MockServerApi,
    providers: string[]
  ): Promise<void> {
    await mockServer.seedUsers([
      createMockUser({
        id: providerUserId,
        email: providerEmail,
        firstName: 'Sam',
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

    await mockServer.seedOAuthAccounts(
      providerUserId,
      providers.map((provider) => ({
        provider,
        providerId: `${provider}-221`,
        createdAt: '2025-01-01T00:00:00.000Z'
      }))
    );
  }

  async function seedProof(page: Page, token: string): Promise<void> {
    await page.context().addCookies([
      {
        name: 'reauth_proof',
        value: token,
        domain: 'localhost',
        path: '/api/v1/auth'
      }
    ]);
  }

  test('asks for the password, and refuses a wrong one', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: passwordUserId,
      email: passwordEmail,
      roles: ['user']
    });
    await _mockServer.seedOAuthAccounts(passwordUserId, [
      {
        provider: 'google',
        providerId: 'g-220',
        createdAt: '2025-01-01T00:00:00.000Z'
      }
    ]);

    await page.goto('/profile');

    const unlinkCalls: number[] = [];
    page.on('response', (res) => {
      if (
        res.url().includes('/auth/oauth/accounts/') &&
        res.request().method() === 'DELETE'
      ) {
        unlinkCalls.push(res.status());
      }
    });

    await disconnectButton(page, 'Google').click();

    const prompt = page.locator('.oauth-step-up-confirm');
    await expect(prompt).toBeVisible();
    // The prompt is the whole point: nothing is removed before a factor lands.
    expect(unlinkCalls).toEqual([]);

    await prompt.getByLabel('Current password').fill('WrongPassword1');
    await prompt.getByRole('button', { name: 'Disconnect' }).click();

    await expect(
      page.getByText(/current password is incorrect/i).first()
    ).toBeVisible();
    expect(unlinkCalls).toEqual([400]);
    // Refused, so the provider is still a sign-in method.
    await expect(disconnectButton(page, 'Google')).toBeVisible();
  });

  test('unlinks after the password, at every width', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: passwordUserId,
      email: passwordEmail,
      roles: ['user']
    });
    await _mockServer.seedOAuthAccounts(passwordUserId, [
      {
        provider: 'google',
        providerId: 'g-220',
        createdAt: '2025-01-01T00:00:00.000Z'
      }
    ]);

    await page.goto('/profile');
    await disconnectButton(page, 'Google').click();

    const prompt = page.locator('.oauth-step-up-confirm');
    await expect(prompt).toBeVisible();

    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      for (const width of [375, 768, 1366]) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        );
        expect(
          overflow,
          `horizontal overflow at ${width}px in ${colorScheme}`
        ).toBeLessThanOrEqual(0);
      }
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1366, height: 900 });

    const accepted = page.waitForResponse(
      (res) =>
        res.url().includes('/auth/oauth/accounts/') &&
        res.request().method() === 'DELETE',
      { timeout: 15_000 }
    );

    await prompt.getByLabel('Current password').fill('Password1');
    await prompt.getByRole('button', { name: 'Disconnect' }).click();

    const response = await accepted;
    expect(response.status()).toBe(200);
    // The password travels in the DELETE body, which is what the server reads.
    expect(response.request().postDataJSON()).toEqual({
      currentPassword: 'Password1'
    });

    await expect(prompt).toHaveCount(0);
    await expect(
      page
        .locator('.oauth-provider-row')
        .filter({ hasText: 'Google' })
        .getByRole('button', { name: /^Connect$/i })
    ).toBeVisible();
  });

  // An account created through a provider holds no password, so it proves
  // itself at a provider it still holds. That is a round trip of its own,
  // before the request that removes the row.
  test('sends an account with no password to its provider first', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: providerUserId,
      email: providerEmail,
      roles: ['user']
    });
    await seedProviderOnlyUser(_mockServer, ['google', 'facebook']);

    await page.goto('/profile');

    const initiated = page.waitForResponse(
      (res) =>
        res.url().includes('/auth/oauth/reauth-init') &&
        res.request().method() === 'POST',
      { timeout: 15_000 }
    );
    await disconnectButton(page, 'Facebook').click();

    const response = await initiated;
    expect(response.request().postDataJSON()).toEqual({
      operation: STEP_UP_OPERATION.OAUTH_UNLINK
    });
    // No password prompt: this account could never answer it.
    await expect(page.locator('.oauth-step-up-confirm')).toHaveCount(0);
  });

  test('unlinks on the load that follows the round trip', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: providerUserId,
      email: providerEmail,
      roles: ['user']
    });
    await seedProviderOnlyUser(_mockServer, ['google', 'facebook']);

    const { token } = await _mockServer.issueReauthProof(
      providerUserId,
      STEP_UP_OPERATION.OAUTH_UNLINK
    );
    await seedProof(page, token);

    // Seed before the document runs: the page reads and clears the key during
    // bootstrap, which happens after `page.goto` resolves.
    await page.addInitScript(() =>
      sessionStorage.setItem('pending_oauth_unlink', 'facebook')
    );

    const accepted = page.waitForResponse(
      (res) =>
        res.url().includes('/auth/oauth/accounts/facebook') &&
        res.request().method() === 'DELETE',
      { timeout: 15_000 }
    );

    await page.goto('/profile?reauth=ok');

    const response = await accepted;
    expect(response.status()).toBe(200);
    await expect(
      page.getByText(/facebook account disconnected/i).first()
    ).toBeVisible();
  });

  // The proof names one operation, so a trip taken for the link buys no
  // unlink.
  test('refuses a proof taken for another operation', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: providerUserId,
      email: providerEmail,
      roles: ['user']
    });
    await seedProviderOnlyUser(_mockServer, ['google', 'facebook']);

    const { token } = await _mockServer.issueReauthProof(
      providerUserId,
      STEP_UP_OPERATION.OAUTH_LINK
    );
    await seedProof(page, token);
    await page.addInitScript(() =>
      sessionStorage.setItem('pending_oauth_unlink', 'facebook')
    );

    const refused = page.waitForResponse(
      (res) =>
        res.url().includes('/auth/oauth/accounts/facebook') &&
        res.request().method() === 'DELETE' &&
        res.status() === 400,
      { timeout: 15_000 }
    );

    await page.goto('/profile?reauth=ok');
    await refused;

    await expect(disconnectButton(page, 'Facebook')).toBeVisible();
  });
});
