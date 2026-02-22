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
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await expect(page.getByText('User Management')).toBeVisible();
  });

  test('should display users table with correct columns', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
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
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    // Wait for table to load
    await expect(page.locator('mat-paginator')).toBeVisible();

    // Table should have rows (seed data + test user)
    await expect(page.locator('table tbody tr').first()).toBeVisible();

    // The paginator should show a total count > 0
    await expect(page.locator('mat-paginator')).toContainText('of');
  });

  test('should show empty state when no users', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    // Override the users endpoint to return empty paginated response
    await page.route('**/api/v1/users?*', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [],
            meta: { page: 1, limit: 10, total: 0, totalPages: 0 }
          })
        });
      }
      return route.fallback();
    });
    await page.goto('/users');

    await expect(page.getByText('No Users Found')).toBeVisible();
  });

  test('should display paginator', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await expect(page.locator('mat-paginator')).toBeVisible();
  });

  test('should paginate when clicking next page', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    // Wait for first page to load
    await expect(page.locator('mat-paginator')).toBeVisible();

    // Verify next page button is enabled (total > page size)
    const nextButton = page.getByRole('button', { name: 'Next page' });
    await expect(nextButton).toBeEnabled();

    // Click next page
    await nextButton.click();

    // Table should still have rows
    await expect(page.locator('table tbody tr').first()).toBeVisible();
  });

  test('should navigate to detail page on view button click', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    // Override to return a known user on page 1
    const knownUser = {
      id: '1',
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      isActive: true,
      roles: ['admin'],
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    };
    await page.route('**/api/v1/users?*', (route) => {
      if (
        route.request().method() === 'GET' &&
        !route.request().url().includes('/search')
      ) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [knownUser],
            meta: { page: 1, limit: 10, total: 1, totalPages: 1 }
          })
        });
      }
      return route.fallback();
    });
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
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    const knownUser = {
      id: '1',
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      isActive: true,
      roles: ['admin'],
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    };
    await page.route('**/api/v1/users?*', (route) => {
      if (
        route.request().method() === 'GET' &&
        !route.request().url().includes('/search')
      ) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [knownUser],
            meta: { page: 1, limit: 10, total: 1, totalPages: 1 }
          })
        });
      }
      return route.fallback();
    });
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
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
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
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    const knownUser = {
      id: '3',
      email: 'john@example.com',
      firstName: 'John',
      lastName: 'Smith',
      isActive: true,
      roles: ['user'],
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: '2025-02-01T00:00:00.000Z',
      updatedAt: '2025-02-01T00:00:00.000Z'
    };
    await page.route('**/api/v1/users?*', (route) => {
      if (
        route.request().method() === 'GET' &&
        !route.request().url().includes('/search')
      ) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [knownUser],
            meta: { page: 1, limit: 10, total: 1, totalPages: 1 }
          })
        });
      }
      return route.fallback();
    });
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
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    // Wait for table to load
    await expect(page.locator('mat-paginator')).toBeVisible();

    // Find any user row with a delete button and click it
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible();

    const firstRow = rows.first();
    await firstRow
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
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    await expect(page.locator('mat-paginator')).toBeVisible();

    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible();

    const firstRow = rows.first();
    const emailCell = firstRow.locator('td').nth(1);
    const emailText = await emailCell.textContent();

    await firstRow
      .locator('button', {
        has: page.locator('mat-icon', { hasText: 'delete' })
      })
      .click();

    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel' })
      .click();

    await expect(page.getByRole('dialog')).toBeHidden();
    // The user should still be in the table
    await expect(
      page.getByRole('cell', { name: emailText!.trim() })
    ).toBeVisible();
  });
});
