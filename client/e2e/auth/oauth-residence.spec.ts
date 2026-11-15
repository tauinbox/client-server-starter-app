import {
  chooseOption,
  expect,
  markOAuthRoundTripStarted,
  test
} from '../fixtures/base.fixture';
import type { BrowserContext, Page } from '@playwright/test';
import type { UserResponse } from '@app/shared/types';
import type { MockServerApi } from '../fixtures/base.fixture';

const COUNTRY = 'Country of residence';

/**
 * A provider sign-in of an identity that no account holds creates nothing
 * until the user declares the country of residence. The tests start where the
 * browser comes back from the provider, holding the two cookies the callback
 * would have set, minted here by the mock control plane.
 */
async function arriveAsNewIdentity(
  {
    page,
    context,
    mockServer
  }: { page: Page; context: BrowserContext; mockServer: MockServerApi },
  email: string
): Promise<void> {
  const { token, signupToken } = await mockServer.issueOAuthSignup({
    email,
    name: 'New Provider User'
  });

  await page.goto('/login');
  await markOAuthRoundTripStarted(page, '/profile');

  const url = `${new URL(page.url()).origin}/`;

  await context.addCookies([
    { name: 'oauth_data', value: token, url },
    { name: 'oauth_signup', value: signupToken, url }
  ]);

  await page.goto('/oauth/callback');
}

async function hasAccount(
  mockServer: MockServerApi,
  email: string
): Promise<boolean> {
  const { users } = await mockServer.getState();

  return (users as UserResponse[]).some((u) => u.email === email);
}

test.describe('OAuth sign-up - country of residence', () => {
  test('creates the account once the country is declared, then signs it in', async ({
    _mockServer,
    page,
    context
  }) => {
    const email = `oauth-new-${Date.now()}@example.com`;

    await arriveAsNewIdentity(
      { page, context, mockServer: _mockServer },
      email
    );

    await expect(
      page.getByRole('main').getByText('Create your account', { exact: true })
    ).toBeVisible();
    expect(await hasAccount(_mockServer, email)).toBe(false);

    await chooseOption(page, COUNTRY, 'Germany');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/profile/);
    expect(await hasAccount(_mockServer, email)).toBe(true);
  });

  test('refuses a country of a region with no site and keeps the form', async ({
    _mockServer,
    page,
    context
  }) => {
    const email = `oauth-ru-${Date.now()}@example.com`;

    await arriveAsNewIdentity(
      { page, context, mockServer: _mockServer },
      email
    );

    await chooseOption(page, COUNTRY, 'Russia');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('alert')).toHaveText(
      'Registration for this country is not available yet.'
    );
    await expect(page).toHaveURL(/\/oauth\/callback/);

    // The refusal spends nothing, so another country still creates the account.
    await chooseOption(page, COUNTRY, 'Germany');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/profile/);
  });

  test('sends the user back to the login page on a cancel', async ({
    _mockServer,
    page,
    context
  }) => {
    await arriveAsNewIdentity(
      { page, context, mockServer: _mockServer },
      `oauth-cancel-${Date.now()}@example.com`
    );

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page).toHaveURL(/\/login\?oauth_error=oauth_cancelled/);
  });
});
