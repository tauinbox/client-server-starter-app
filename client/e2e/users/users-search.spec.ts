import {
  expect,
  expectAuthRedirect,
  expectForbiddenRedirect,
  loginViaUi,
  test
} from '../fixtures/base.fixture';

test.describe('User Search page', () => {
  test('should redirect to login when not authenticated', async ({
    _mockServer,
    page
  }) => {
    await expectAuthRedirect(page, '/users/search');
  });

  test('should redirect to forbidden when non-admin', async ({
    _mockServer,
    page
  }) => {
    await expectForbiddenRedirect(page, _mockServer.url, '/users/search');
  });

  test('should display "Search Users" heading', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/search');

    await expect(page.getByText('Search Users')).toBeVisible();
  });

  test('should display search form fields', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/search');

    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('First Name')).toBeVisible();
    await expect(page.getByLabel('Last Name')).toBeVisible();
    await expect(page.getByLabel('Status')).toBeVisible();
  });

  test('should display search results in table after searching', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/search');

    await page.getByLabel('Email').fill('example');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('Search Results')).toBeVisible();
    // Results are paginated — check that at least one example.com user appears
    await expect(
      page.getByRole('cell', { name: /example\.com/ }).first()
    ).toBeVisible();
  });

  test('should display result count', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/search');

    // Search for "Smith" last name — only John Smith matches
    await page.getByLabel('Last Name').fill('Smith');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('1 user(s) found')).toBeVisible();
  });

  test('should show empty state when no results', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/search');

    // Search for a non-existent email
    await page.getByLabel('Email').fill('nonexistent@nowhere.com');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('No Users Found')).toBeVisible();
  });

  test('should clear results and form on "Clear" button click', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/search');

    await page.getByLabel('Email').fill('example');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('Search Results')).toBeVisible();

    await page.getByRole('button', { name: 'Clear' }).click();

    await expect(page.getByText('Search Results')).toBeHidden();
    await expect(page.getByLabel('Email')).toHaveValue('');
  });

  test('should navigate to detail page on view button click', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/search');

    await page.getByLabel('Email').fill('admin@example.com');
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
    await page.goto('/users/search');

    await page.getByLabel('Email').fill('admin@example.com');
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
    await page.goto('/users/search');

    await page.getByLabel('Status').click();
    await page.getByRole('option', { name: 'Active', exact: true }).click();
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('Search Results')).toBeVisible();
    expect(capturedUrls[0]).toContain('isActive=true');
  });

  test('should delete user from results with confirmation', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/search');

    await page.getByLabel('Email').fill('john@example.com');
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
