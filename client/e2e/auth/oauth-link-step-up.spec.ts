import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import type { MockServerApi } from '../fixtures/base.fixture';
import { createMockUser } from '../fixtures/mock-data';
import { STEP_UP_OPERATION } from '@app/shared/constants';
import type { Page } from '@playwright/test';

// A linked provider signs the account in, and no recovery path removes it: a
// password reset ends every session and leaves the row. So the link route
// demands the same fresh proof of identity the other credential changes demand.
test.describe('Linking a provider demands a step-up', () => {
  const passwordUserId = '210';
  const passwordEmail = 'link-step-up@example.com';
  const providerUserId = '211';
  const providerEmail = 'link-provider-only@example.com';

  /** The row for a provider that is offered but not linked yet. */
  function connectButton(page: Page, provider: string) {
    return page
      .locator('.oauth-provider-row')
      .filter({ hasText: provider })
      .getByRole('button', { name: /^Connect$/i });
  }

  async function seedProviderOnlyUser(
    mockServer: MockServerApi
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

    await mockServer.seedOAuthAccounts(providerUserId, [
      {
        provider: 'google',
        providerId: 'g-211',
        createdAt: '2025-01-01T00:00:00.000Z'
      }
    ]);
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

    await page.goto('/profile');

    const linkCalls: number[] = [];
    page.on('response', (res) => {
      if (
        res.url().includes('/auth/oauth/link-init') &&
        res.request().method() === 'POST'
      ) {
        linkCalls.push(res.status());
      }
    });

    await connectButton(page, 'Google').click();

    const prompt = page.locator('.oauth-link-confirm');
    await expect(prompt).toBeVisible();
    // The prompt is the whole point: nothing is minted before a factor lands.
    expect(linkCalls).toEqual([]);

    await prompt.getByLabel('Current password').fill('WrongPassword1');
    await prompt.getByRole('button', { name: 'Continue' }).click();

    await expect(
      page.getByText(/current password is incorrect/i).first()
    ).toBeVisible();
    await expect(prompt).toBeVisible();
    expect(page.url()).toContain('/profile');
    expect(linkCalls).toEqual([400]);
  });

  test('links after the password, at every width', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: passwordUserId,
      email: passwordEmail,
      roles: ['user']
    });

    await page.goto('/profile');
    await connectButton(page, 'Google').click();

    const prompt = page.locator('.oauth-link-confirm');
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
        res.url().includes('/auth/oauth/link-init') &&
        res.request().method() === 'POST',
      { timeout: 15_000 }
    );

    await prompt.getByLabel('Current password').fill('Password1');
    await prompt.getByRole('button', { name: 'Continue' }).click();

    const response = await accepted;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({
      currentPassword: 'Password1'
    });

    // The provider half answers 501 in the mock, so the address is the proof
    // that the intent was minted and the browser left for the provider.
    await page.waitForURL(/\/api\/v1\/auth\/oauth\/google/, {
      timeout: 15_000
    });
  });

  // An account created through a provider holds no password, so it proves
  // itself at the provider it already has. That is a round trip of its own,
  // before the round trip that does the linking.
  test('sends an account with no password to its provider first', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: providerUserId,
      email: providerEmail,
      roles: ['user']
    });
    await seedProviderOnlyUser(_mockServer);

    await page.goto('/profile');

    const initiated = page.waitForResponse(
      (res) =>
        res.url().includes('/auth/oauth/reauth-init') &&
        res.request().method() === 'POST',
      { timeout: 15_000 }
    );
    await connectButton(page, 'Facebook').click();

    const response = await initiated;
    expect(response.request().postDataJSON()).toEqual({
      operation: STEP_UP_OPERATION.OAUTH_LINK
    });
    // No password prompt: this account could never answer it.
    await expect(page.locator('.oauth-link-confirm')).toHaveCount(0);
  });

  test('links on the load that follows the round trip', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: providerUserId,
      email: providerEmail,
      roles: ['user']
    });
    await seedProviderOnlyUser(_mockServer);

    const { token } = await _mockServer.issueReauthProof(
      providerUserId,
      STEP_UP_OPERATION.OAUTH_LINK
    );
    await seedProof(page, token);

    // Seed before the document runs: the page reads and clears the key during
    // bootstrap, which happens after `page.goto` resolves.
    await page.addInitScript(() =>
      sessionStorage.setItem('pending_oauth_link', 'facebook')
    );

    const accepted = page.waitForResponse(
      (res) =>
        res.url().includes('/auth/oauth/link-init') &&
        res.request().method() === 'POST',
      { timeout: 15_000 }
    );

    await page.goto('/profile?reauth=ok');

    const response = await accepted;
    expect(response.status()).toBe(200);
    await page.waitForURL(/\/api\/v1\/auth\/oauth\/facebook/, {
      timeout: 15_000
    });
  });

  // The proof names one operation, so a trip taken for the two-factor
  // enrolment buys no provider link.
  test('refuses a proof taken for another operation', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: providerUserId,
      email: providerEmail,
      roles: ['user']
    });
    await seedProviderOnlyUser(_mockServer);

    const { token } = await _mockServer.issueReauthProof(
      providerUserId,
      STEP_UP_OPERATION.MFA_SETUP
    );
    await seedProof(page, token);
    await page.addInitScript(() =>
      sessionStorage.setItem('pending_oauth_link', 'facebook')
    );

    const refused = page.waitForResponse(
      (res) =>
        res.url().includes('/auth/oauth/link-init') &&
        res.request().method() === 'POST' &&
        res.status() === 400,
      { timeout: 15_000 }
    );

    await page.goto('/profile?reauth=ok');
    await refused;

    expect(page.url()).toContain('/profile');
  });
});
