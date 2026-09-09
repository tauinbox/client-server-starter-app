import { expect, test } from '../fixtures/base.fixture';
import { createMockUser, createOAuthAccount } from '../fixtures/mock-data';
import { mockId } from '../fixtures/ids';
import { MOCK_TOTP_CODE } from '../../../mock-server/src/constants';
import type { Page, BrowserContext } from '@playwright/test';
import type { MockServerApi } from '../fixtures/base.fixture';

/**
 * A provider proves one credential. An account that carries a second factor is
 * therefore not signed in by the round trip alone: the callback must ask for a
 * code, exactly as the password card does.
 *
 * The round trip needs a real identity provider, so these tests start where the
 * browser comes back: holding the `oauth_data` cookie the provider callback
 * would have set, minted here by the mock control plane.
 */
const USER_ID = mockId('oauth-factor');

async function arriveAtCallback(
  page: Page,
  context: BrowserContext,
  mockServer: MockServerApi,
  options: { enrolled: boolean }
): Promise<void> {
  await mockServer.seedUsers([
    createMockUser({
      id: USER_ID,
      email: 'oauth-factor@example.com',
      firstName: 'Oauth',
      lastName: 'Factor',
      password: null,
      roles: ['user'],
      isEmailVerified: true,
      totpEnabledAt: options.enrolled ? '2026-01-01T00:00:00.000Z' : null
    })
  ]);
  await mockServer.seedOAuthAccounts(USER_ID, [
    createOAuthAccount({ provider: 'google' })
  ]);

  const { token } = await mockServer.issueOAuthData(USER_ID);

  await page.goto('/login');
  await context.addCookies([
    {
      name: 'oauth_data',
      value: token,
      url: `${new URL(page.url()).origin}/api/v1/auth/oauth`
    }
  ]);

  await page.goto('/oauth/callback');
}

test.describe('OAuth sign-in on an account with a second factor', () => {
  test('asks for a code instead of signing the caller in', async ({
    _mockServer,
    page,
    context
  }) => {
    await arriveAtCallback(page, context, _mockServer, { enrolled: true });

    await expect(page.getByLabel('Authentication code')).toBeVisible();
    // Still on the callback route: no session, so no landing page.
    await expect(page).toHaveURL(/\/oauth\/callback/);

    await page.getByLabel('Authentication code').fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Verify' }).click();

    await expect(page).toHaveURL(/\/profile/);
    await expect(page.getByText('oauth-factor@example.com')).toBeVisible();
  });

  test('takes the user back to the login page when the code step is cancelled', async ({
    _mockServer,
    page,
    context
  }) => {
    await arriveAtCallback(page, context, _mockServer, { enrolled: true });

    await page.getByRole('button', { name: 'Back to sign in' }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('signs an account with no factor straight in, as before', async ({
    _mockServer,
    page,
    context
  }) => {
    await arriveAtCallback(page, context, _mockServer, { enrolled: false });

    await expect(page).toHaveURL(/\/profile/);
    await expect(page.getByLabel('Authentication code')).toHaveCount(0);
  });
});
