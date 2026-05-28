import { expect, loginViaUi, test } from '../fixtures/base.fixture';

test.describe('Inline user search (User Management page)', () => {
  test('should display search form fields', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await expect(page.getByLabel('Search')).toBeVisible();
    await expect(page.getByLabel('Role')).toBeVisible();
    await expect(page.getByLabel('Status')).toBeVisible();
  });

  test('should display search results in table after searching', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await page.getByLabel('Search').fill('example');
    await page.getByRole('button', { name: 'Search' }).click();

    // Results are paginated — check that at least one example.com user appears
    await expect(
      page.getByRole('cell', { name: /example\.com/ }).first()
    ).toBeVisible();
  });

  test('should show empty state when no results', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    // Search for a non-existent email
    await page.getByLabel('Search').fill('nonexistent@nowhere.com');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('No Users Found')).toBeVisible();
  });

  test('should clear form on "Clear" button click', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await page.getByLabel('Search').fill('example');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(
      page.getByRole('cell', { name: /example\.com/ }).first()
    ).toBeVisible();

    await page.getByRole('button', { name: 'Clear' }).click();

    await expect(page.getByLabel('Search')).toHaveValue('');
  });

  test('should navigate to detail page on view button click', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await page.getByLabel('Search').fill('admin@example.com');
    await page.getByRole('button', { name: 'Search' }).click();

    const row = page.getByRole('row', { name: /admin@example\.com/ });
    await row
      .locator('button', {
        has: page.locator('mat-icon', { hasText: 'visibility' })
      })
      .click();

    await expect(page).toHaveURL(/.*\/users\/1$/);
  });

  test('should navigate to edit page on edit button click', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await page.getByLabel('Search').fill('admin@example.com');
    await page.getByRole('button', { name: 'Search' }).click();

    const row = page.getByRole('row', { name: /admin@example\.com/ });
    await row
      .locator('button', { has: page.locator('mat-icon', { hasText: 'edit' }) })
      .click();

    await expect(page).toHaveURL(/.*\/users\/1\/edit$/);
  });

  test('should send isActive=true when "Active" status is selected', async ({
    _mockServer,
    page
  }) => {
    const capturedUrls: string[] = [];
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.route('**/api/v1/users/search*', (route) => {
      capturedUrls.push(route.request().url());
      return route.fallback();
    });
    await page.goto('/users');

    await page.getByLabel('Status').click();
    await page.getByRole('option', { name: 'Active', exact: true }).click();
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(
      page.getByRole('cell', { name: /example\.com/ }).first()
    ).toBeVisible();
    expect(capturedUrls[0]).toContain('isActive=true');
  });

  test('should filter users by selected role', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await page.getByLabel('Role').click();
    await page.getByRole('option', { name: 'admin', exact: true }).click();
    await page.getByRole('button', { name: 'Search' }).click();

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

    await page.getByLabel('Search').fill('john@example.com');
    await page.getByRole('button', { name: 'Search' }).click();

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
