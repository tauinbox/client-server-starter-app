import {
  expect,
  loginViaUi,
  mockDeleteUser,
  mockGetUsers,
  test
} from '../fixtures/base.fixture';

test.describe('User List page', () => {
  test('should redirect to login when not authenticated', async ({
    mockApi: page
  }) => {
    await page.goto('/users');

    await expect(page).toHaveURL(/.*\/login/);
  });

  test('should redirect to forbidden when non-admin', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: false });
    await page.goto('/users');

    await expect(page).toHaveURL(/.*\/forbidden/);
  });

  test('should display "User Management" heading', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUsers(page);
    await page.goto('/users');

    await expect(page.getByText('User Management')).toBeVisible();
  });

  test('should display users table with correct columns', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUsers(page);
    await page.goto('/users');

    await expect(page.getByRole('columnheader', { name: 'Email' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Role' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Created' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Actions' })).toBeVisible();
  });

  test('should display user data in table rows', async ({ mockApi: page }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUsers(page);
    await page.goto('/users');

    await expect(page.getByRole('cell', { name: 'admin@example.com' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Admin User' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'john@example.com' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'John Smith' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Active' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Inactive' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Admin', exact: true })).toBeVisible();
  });

  test('should show empty state when no users', async ({ mockApi: page }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUsers(page, []);
    await page.goto('/users');

    await expect(page.getByText('No Users Found')).toBeVisible();
  });

  test('should display paginator', async ({ mockApi: page }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUsers(page);
    await page.goto('/users');

    await expect(page.locator('mat-paginator')).toBeVisible();
  });

  test('should paginate when more users than page size', async ({
    mockApi: page
  }) => {
    const manyUsers = Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1),
      email: `user${i + 1}@example.com`,
      firstName: `First${i + 1}`,
      lastName: `Last${i + 1}`,
      isAdmin: false,
      isActive: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    }));

    await loginViaUi(page, { isAdmin: true });
    await mockGetUsers(page, manyUsers);
    await page.goto('/users');

    await expect(page.getByRole('cell', { name: 'user1@example.com' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'user10@example.com' })).toBeVisible();

    await page.getByRole('button', { name: 'Next page' }).click();

    await expect(page.getByRole('cell', { name: 'user11@example.com' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'user12@example.com' })).toBeVisible();
  });

  test('should navigate to detail page on view button click', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUsers(page);
    await page.goto('/users');

    const row = page.getByRole('row', { name: /admin@example\.com/ });
    await row.locator('button', { has: page.locator('mat-icon', { hasText: 'visibility' }) }).click();

    await expect(page).toHaveURL(/.*\/users\/1$/);
  });

  test('should navigate to edit page on edit button click', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUsers(page);
    await page.goto('/users');

    const row = page.getByRole('row', { name: /admin@example\.com/ });
    await row.locator('button', { has: page.locator('mat-icon', { hasText: 'edit' }) }).click();

    await expect(page).toHaveURL(/.*\/users\/1\/edit$/);
  });

  test('should navigate to search page on search button click', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUsers(page);
    await page.goto('/users');

    await page.locator('button', { has: page.locator('mat-icon', { hasText: 'search' }) }).click();

    await expect(page).toHaveURL(/.*\/users\/search$/);
  });

  test('should show confirmation dialog on delete button click', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUsers(page);
    await page.goto('/users');

    const row = page.getByRole('row', { name: /john@example\.com/ });
    await row.locator('button', { has: page.locator('mat-icon', { hasText: 'delete' }) }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Confirm Delete')).toBeVisible();
    await expect(page.getByText(/Are you sure you want to delete user John Smith/)).toBeVisible();
  });

  test('should delete user after confirming', async ({ mockApi: page }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUsers(page);
    await mockDeleteUser(page);
    await page.goto('/users');

    const row = page.getByRole('row', { name: /john@example\.com/ });
    await row.locator('button', { has: page.locator('mat-icon', { hasText: 'delete' }) }).click();

    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('User deleted successfully')).toBeVisible();
  });

  test('should not delete user when cancelling dialog', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUsers(page);
    await page.goto('/users');

    const row = page.getByRole('row', { name: /john@example\.com/ });
    await row.locator('button', { has: page.locator('mat-icon', { hasText: 'delete' }) }).click();

    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('cell', { name: 'john@example.com' })).toBeVisible();
  });
});
