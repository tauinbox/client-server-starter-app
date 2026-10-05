import type { Page } from '@playwright/test';
import {
  chooseOption,
  expect,
  listResponse,
  loginViaUi,
  test
} from '../fixtures/base.fixture';
import { mockId } from '../fixtures/ids';

const SEARCH_PATH = '/api/v1/users/search/cursor';

/** Types a term and waits for the search that the pause in typing sends. */
async function searchFor(page: Page, q: string): Promise<void> {
  const response = listResponse(page, SEARCH_PATH, { q });
  await page.getByLabel('Search').fill(q);
  await response;
}

test.describe('Inline user search (User Management page)', () => {
  test('should display the search box and the filters, with no Search button', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await expect(page.getByLabel('Search')).toBeVisible();
    for (const label of ['Role', 'Status', 'Email', 'Two-factor', 'Lock']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByLabel('Sign-in')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search' })).toHaveCount(0);
  });

  test('should display search results in table after typing', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await searchFor(page, 'example');

    // Results are paginated — check that at least one example.com user appears
    await expect(
      page.getByRole('cell', { name: /example\.com/ }).first()
    ).toBeVisible();
  });

  test('should send one search for a burst of typing', async ({
    _mockServer,
    page
  }) => {
    const searches: string[] = [];
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.route(`**${SEARCH_PATH}*`, (route) => {
      searches.push(new URL(route.request().url()).searchParams.get('q') ?? '');
      return route.fallback();
    });
    await page.goto('/users');

    const response = listResponse(page, SEARCH_PATH, { q: 'admin@' });
    await page.getByLabel('Search').pressSequentially('admin@', { delay: 30 });
    await response;

    expect(searches).toEqual(['admin@']);
  });

  test('should show empty state when no results', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await searchFor(page, 'nonexistent@nowhere.com');

    await expect(page.getByText('No Users Found')).toBeVisible();
  });

  test('should return to the full list when the search box is emptied', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await searchFor(page, 'nonexistent@nowhere.com');
    await expect(page.getByText('No Users Found')).toBeVisible();

    const fullList = listResponse(page, '/api/v1/users/cursor', {});
    await page.getByLabel('Search').fill('');
    await fullList;

    await expect(
      page.getByRole('cell', { name: /example\.com/ }).first()
    ).toBeVisible();
  });

  test('should navigate to detail page on view button click', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await searchFor(page, 'admin@example.com');

    const row = page.getByRole('row', { name: /admin@example\.com/ });
    await row
      .locator('button', {
        has: page.locator('mat-icon', { hasText: 'visibility' })
      })
      .click();

    await expect(page).toHaveURL(new RegExp(`/users/${mockId('user-1')}$`));
  });

  test('should navigate to edit page on edit button click', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await searchFor(page, 'admin@example.com');

    const row = page.getByRole('row', { name: /admin@example\.com/ });
    await row
      .locator('button', { has: page.locator('mat-icon', { hasText: 'edit' }) })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/users/${mockId('user-1')}/edit$`)
    );
  });

  test('should send isActive=true at once when "Active" status is selected', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    const response = listResponse(page, SEARCH_PATH, { isActive: 'true' });
    await chooseOption(page, 'Status', 'Active');
    await response;

    await expect(
      page.getByRole('cell', { name: /example\.com/ }).first()
    ).toBeVisible();
  });

  test('should send the account-state filters the selects set', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    // The seeded admin is far down the default order, so narrow to it first.
    await searchFor(page, 'admin@example.com');

    const twoFactor = listResponse(page, SEARCH_PATH, {
      q: 'admin@example.com',
      mfaEnabled: 'false'
    });
    await chooseOption(page, 'Two-factor', 'Off');
    await twoFactor;

    const both = listResponse(page, SEARCH_PATH, {
      q: 'admin@example.com',
      mfaEnabled: 'false',
      hasPassword: 'true'
    });
    await chooseOption(page, 'Sign-in', 'Has a password');
    await both;

    await expect(
      page.getByRole('cell', { name: 'admin@example.com' })
    ).toBeVisible();

    // The seeded admin has a password, so "Provider only" leaves no row.
    const providerOnly = listResponse(page, SEARCH_PATH, {
      q: 'admin@example.com',
      hasPassword: 'false'
    });
    await chooseOption(page, 'Sign-in', 'Provider only');
    await providerOnly;
    await expect(page.getByText('No Users Found')).toBeVisible();
  });

  test('should filter users by selected role', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    const response = listResponse(page, SEARCH_PATH, { role: 'admin' });
    await chooseOption(page, 'Role', 'admin');
    await response;

    // Seeded admin appears; a user-only account is filtered out.
    await expect(
      page.getByRole('cell', { name: 'admin@example.com' })
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'user@example.com' })
    ).toHaveCount(0);
  });

  test('should delete user from results with confirmation', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await searchFor(page, 'john@example.com');

    const row = page.getByRole('row', { name: /john@example\.com/ });
    await row
      .locator('button', {
        has: page.locator('mat-icon', { hasText: 'delete' })
      })
      .click();

    await expect(page.getByRole('dialog')).toBeVisible();

    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect(page.getByText('User deleted successfully')).toBeVisible();
  });
});
