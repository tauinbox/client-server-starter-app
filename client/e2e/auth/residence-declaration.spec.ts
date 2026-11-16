import { chooseOption, expect, test } from '../fixtures/base.fixture';
import type { Page } from '@playwright/test';
import type { MockServerApi } from '../fixtures/base.fixture';
import { createMockUser } from '../../../mock-server/src/factories';

const COUNTRY = 'Country of residence';
const PASSWORD = 'Password1';

/**
 * An account with no declared country of residence (an account from before
 * the field, or one that an administrator created) declares it once, before
 * any other page, at its next sign-in.
 */
async function signInWithNoCountry(
  { page, mockServer }: { page: Page; mockServer: MockServerApi },
  target: string
): Promise<string> {
  const email = `no-country-${Date.now()}@example.com`;

  await mockServer.seedUsers([
    createMockUser({
      email,
      name: 'Undeclared Owner',
      password: PASSWORD,
      residenceCountry: null
    })
  ]);

  await page.goto(`/login?returnUrl=${encodeURIComponent(target)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Email').blur();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Password', { exact: true }).blur();
  await page.getByRole('main').getByRole('button', { name: 'Login' }).click();

  return email;
}

test.describe('Country of residence declaration at sign-in', () => {
  test('asks before the page the account asked for, then goes there', async ({
    _mockServer,
    page
  }) => {
    await signInWithNoCountry({ page, mockServer: _mockServer }, '/profile');

    await expect(page).toHaveURL(/\/residence\?returnUrl=%2Fprofile$/);
    await expect(page.locator('mat-card-title')).toHaveText(
      'Country of residence'
    );

    await chooseOption(page, COUNTRY, 'Germany');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page).toHaveURL(/\/profile$/);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Undeclared Owner' })
    ).toBeVisible();

    // The declaration is stored: a reload asks nothing again.
    await page.reload();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Undeclared Owner' })
    ).toBeVisible();
    await expect(page).toHaveURL(/\/profile$/);
  });

  test('keeps the account on the page after a refused country', async ({
    _mockServer,
    page
  }) => {
    await signInWithNoCountry({ page, mockServer: _mockServer }, '/profile');
    await expect(page).toHaveURL(/\/residence/);

    await chooseOption(page, COUNTRY, 'Russia');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('alert')).toHaveText(
      'Accounts for this country are not available yet.'
    );
    await expect(page).toHaveURL(/\/residence/);

    // Every other signed-in page still sends the account back here.
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/residence\?returnUrl=%2Fprofile$/);
  });

  test('signs out from the page', async ({ _mockServer, page }) => {
    await signInWithNoCountry({ page, mockServer: _mockServer }, '/profile');
    await expect(page).toHaveURL(/\/residence/);

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/login/);
  });

  test('an account with a country never sees the page', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/residence?returnUrl=%2Fprofile');
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel('Email').fill('user@example.com');
    await page.getByLabel('Email').blur();
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Password', { exact: true }).blur();
    await page.getByRole('main').getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/\/profile$/);
  });
});
