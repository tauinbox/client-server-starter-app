import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import type { MockServerApi } from '../fixtures/base.fixture';
import { createMockUser } from '../fixtures/mock-data';
import {
  MOCK_RECOVERY_CODES,
  MOCK_TOTP_CODE,
  MOCK_TOTP_SECRET
} from '../../../mock-server/src/constants';
import { STEP_UP_OPERATION } from '@app/shared/constants';
import type { MockUser } from '../fixtures/mock-data';
import type { Page } from '@playwright/test';

// An account created through a provider holds no password, so the card that
// asks for one is a surface it can never use. It proves itself with a provider
// round trip instead. The mock has no such round trip, so __control seeds the
// proof the callback would have minted.
test.describe('OAuth-only account turns two-factor on', () => {
  const userId = '220';
  const email = 'provider-mfa@example.com';

  async function seedOAuthOnlyUser(
    mockServer: MockServerApi,
    overrides: Partial<MockUser> = {}
  ): Promise<void> {
    await mockServer.seedUsers([
      createMockUser({
        id: userId,
        email,
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
        deletedAt: null,
        ...overrides
      })
    ]);

    await mockServer.seedOAuthAccounts(userId, [
      {
        provider: 'google',
        providerId: 'g-220',
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

  test('offers the round trip instead of asking for a password', async ({
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

    const card = page.locator('nxs-two-factor');
    await expect(card.getByRole('button', { name: 'Turn on' })).toBeVisible();
    // The instruction this account could never follow.
    await expect(
      card.getByText(/Set a password for this account/i)
    ).toHaveCount(0);
    await expect(card.getByText(/Google/)).toBeVisible();
  });

  test('takes the round trip for the enrolment and nothing else', async ({
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

    const initiated = page.waitForResponse(
      (res) =>
        res.url().includes('/auth/oauth/reauth-init') &&
        res.request().method() === 'POST',
      { timeout: 15_000 }
    );
    await page
      .locator('nxs-two-factor')
      .getByRole('button', { name: 'Turn on' })
      .click();

    // A proof minted for another operation is refused by the setup route, so
    // the operation the trip declares is the whole point of this assertion.
    const response = await initiated;
    expect(response.request().postDataJSON()).toEqual({
      operation: STEP_UP_OPERATION.MFA_SETUP
    });
  });

  test('enrols on the load that follows the round trip', async ({
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
      STEP_UP_OPERATION.MFA_SETUP
    );
    await seedProof(page, token);

    // Seed before the document runs: the page reads and clears the key during
    // bootstrap, which happens after `page.goto` resolves.
    await page.addInitScript(() =>
      sessionStorage.setItem('pending_mfa_setup', 'true')
    );

    // The reload that follows the enrolment builds a new card, which must not
    // read the resume signal again and ask for a second secret.
    const setupCalls: number[] = [];
    page.on('response', (res) => {
      if (
        res.url().includes('/auth/mfa/setup') &&
        res.request().method() === 'POST'
      ) {
        setupCalls.push(res.status());
      }
    });

    await page.goto('/profile?reauth=ok');

    await expect(page.locator('.two-factor-qr')).toBeVisible({
      timeout: 10_000
    });
    await expect(page.getByText(MOCK_TOTP_SECRET)).toBeVisible();

    await page.getByLabel('Authentication code').fill(MOCK_TOTP_CODE);
    await page
      .locator('nxs-two-factor')
      .getByRole('button', { name: 'Turn on' })
      .click();

    await expect(page.getByText(MOCK_RECOVERY_CODES[0])).toBeVisible();
    await page.getByRole('button', { name: 'I saved them' }).click();
    await expect(
      page
        .locator('nxs-two-factor')
        .getByText('Two-factor authentication is on')
    ).toBeVisible();

    expect(setupCalls).toEqual([200]);
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
    await seedProof(page, token);
    await page.addInitScript(() =>
      sessionStorage.setItem('pending_mfa_setup', 'true')
    );

    const refused = page.waitForResponse(
      (res) =>
        res.url().includes('/auth/mfa/setup') &&
        res.request().method() === 'POST' &&
        res.status() === 400,
      { timeout: 15_000 }
    );
    await page.goto('/profile?reauth=ok');
    await refused;

    await expect(page.locator('.two-factor-qr')).toHaveCount(0);
  });

  test('turns the factor off with a code, at every width', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: userId,
      email,
      roles: ['user']
    });
    await seedOAuthOnlyUser(_mockServer, {
      totpSecret: MOCK_TOTP_SECRET,
      totpEnabledAt: '2025-02-01T00:00:00.000Z',
      totpRecoveryCodes: [...MOCK_RECOVERY_CODES]
    });

    await page.goto('/profile');

    const card = page.locator('nxs-two-factor');
    await expect(card.getByText('Two-factor authentication is on')).toBeVisible(
      { timeout: 10_000 }
    );

    await card.getByRole('button', { name: 'Turn off' }).click();

    // The password field is the one this account can never fill.
    await expect(page.getByLabel('Current password')).toHaveCount(0);

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

    await page.getByLabel('Authentication code').fill(MOCK_TOTP_CODE);
    await card.getByRole('button', { name: 'Turn off' }).click();

    await expect(
      card.getByText('Two-factor authentication is off')
    ).toBeVisible({ timeout: 10_000 });
  });
});
