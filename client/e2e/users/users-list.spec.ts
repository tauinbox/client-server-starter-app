import {
  expect,
  expectAuthRedirect,
  expectForbiddenRedirect,
  loginViaUi,
  test
} from '../fixtures/base.fixture';

test.describe('User List page', () => {
  test('should redirect to login when not authenticated', async ({
    _mockServer,
    page
  }) => {
    await expectAuthRedirect(page, '/users');
  });

  test('should redirect to forbidden when non-admin', async ({
    _mockServer,
    page
  }) => {
    await expectForbiddenRedirect(page, _mockServer.url, '/users');
  });

  test('should display "User Management" heading', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { isAdmin: true });
    await page.goto('/users');

    await expect(page.getByText('User Management')).toBeVisible();
  });

  test('should display users table with correct columns', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { isAdmin: true });
    await page.goto('/users');

    await expect(
      page.getByRole('columnheader', { name: 'Email' })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Name' })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Status' })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Role' })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Created' })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Actions' })
    ).toBeVisible();
  });

  test('should display user data in table rows', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { isAdmin: true });
    await page.goto('/users');

    // Seed data includes admin@example.com, john@example.com, jane@example.com
    await expect(
      page.getByRole('cell', { name: 'admin@example.com' })
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Admin User' })).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'john@example.com' })
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: 'John Smith' })).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'Active' }).first()
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'Inactive' }).first()
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'Admin', exact: true }).first()
    ).toBeVisible();
  });

  test('should show empty state when no users', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { isAdmin: true });
    // Override the users endpoint to return empty array
    await page.route('**/api/v1/users', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '[]'
        });
      }
      return route.fallback();
    });
    await page.goto('/users');

    await expect(page.getByText('No Users Found')).toBeVisible();
  });

  test('should display paginator', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { isAdmin: true });
    await page.goto('/users');

    await expect(page.locator('mat-paginator')).toBeVisible();
  });

  test('should paginate when more users than page size', async ({
    _mockServer,
    page
  }) => {
    // Seed 12 users for pagination
    const manyUsers = Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 200),
      email: `user${i + 1}@example.com`,
      firstName: `First${i + 1}`,
      lastName: `Last${i + 1}`,
      password: 'Password1',
      isAdmin: false,
      isActive: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    }));

    // Override users endpoint to return exactly these 12
    await loginViaUi(page, _mockServer.url, { isAdmin: true });
    await page.route('**/api/v1/users', (route) => {
      if (
        route.request().method() === 'GET' &&
        !route.request().url().includes('/search')
      ) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(manyUsers)
        });
      }
      return route.fallback();
    });
    await page.goto('/users');

    await expect(
      page.getByRole('cell', { name: 'user1@example.com' })
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'user10@example.com' })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Next page' }).click();

    await expect(
      page.getByRole('cell', { name: 'user11@example.com' })
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'user12@example.com' })
    ).toBeVisible();
  });

  test('should navigate to detail page on view button click', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { isAdmin: true });
    await page.goto('/users');

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
    await loginViaUi(page, _mockServer.url, { isAdmin: true });
    await page.goto('/users');

    const row = page.getByRole('row', { name: /admin@example\.com/ });
    await row
      .locator('button', { has: page.locator('mat-icon', { hasText: 'edit' }) })
      .click();

    await expect(page).toHaveURL(/.*\/users\/1\/edit$/);
  });

  test('should navigate to search page on search button click', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { isAdmin: true });
    await page.goto('/users');

    await page
      .locator('button', {
        has: page.locator('mat-icon', { hasText: 'search' })
      })
      .click();

    await expect(page).toHaveURL(/.*\/users\/search$/);
  });

  test('should show confirmation dialog on delete button click', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { isAdmin: true });
    await page.goto('/users');

    const row = page.getByRole('row', { name: /john@example\.com/ });
    await row
      .locator('button', {
        has: page.locator('mat-icon', { hasText: 'delete' })
      })
      .click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Confirm Delete')).toBeVisible();
    await expect(
      page.getByText(/Are you sure you want to delete user John Smith/)
    ).toBeVisible();
  });

  test('should delete user after confirming', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { isAdmin: true });
    await page.goto('/users');

    const row = page.getByRole('row', { name: /john@example\.com/ });
    await row
      .locator('button', {
        has: page.locator('mat-icon', { hasText: 'delete' })
      })
      .click();

    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect(page.getByText('User deleted successfully')).toBeVisible();
  });

  test('should not delete user when cancelling dialog', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { isAdmin: true });
    await page.goto('/users');

    const row = page.getByRole('row', { name: /john@example\.com/ });
    await row
      .locator('button', {
        has: page.locator('mat-icon', { hasText: 'delete' })
      })
      .click();

    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel' })
      .click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(
      page.getByRole('cell', { name: 'john@example.com' })
    ).toBeVisible();
  });
});
