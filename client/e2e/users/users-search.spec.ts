import {
  expect,
  expectAuthRedirect,
  expectForbiddenRedirect,
  loginViaUi,
  mockDeleteUser,
  mockSearchUsers,
  mockSearchUsersWithCapture,
  test
} from '../fixtures/base.fixture';

test.describe('User Search page', () => {
  test('should redirect to login when not authenticated', async ({
    mockApi: page
  }) => {
    await expectAuthRedirect(page, '/users/search');
  });

  test('should redirect to forbidden when non-admin', async ({
    mockApi: page
  }) => {
    await expectForbiddenRedirect(page, '/users/search');
  });

  test('should display "Search Users" heading', async ({ mockApi: page }) => {
    await loginViaUi(page, { isAdmin: true });
    await page.goto('/users/search');

    await expect(page.getByText('Search Users')).toBeVisible();
  });

  test('should display search form fields', async ({ mockApi: page }) => {
    await loginViaUi(page, { isAdmin: true });
    await page.goto('/users/search');

    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('First Name')).toBeVisible();
    await expect(page.getByLabel('Last Name')).toBeVisible();
    await expect(page.getByLabel('Role')).toBeVisible();
    await expect(page.getByLabel('Status')).toBeVisible();
  });

  test('should display search results in table after searching', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockSearchUsers(page);
    await page.goto('/users/search');

    await page.getByLabel('Email').fill('example');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('Search Results')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'admin@example.com' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'john@example.com' })).toBeVisible();
  });

  test('should display result count', async ({ mockApi: page }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockSearchUsers(page);
    await page.goto('/users/search');

    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('3 user(s) found')).toBeVisible();
  });

  test('should show empty state when no results', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockSearchUsers(page, []);
    await page.goto('/users/search');

    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('No Users Found')).toBeVisible();
  });

  test('should clear results and form on "Clear" button click', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockSearchUsers(page);
    await page.goto('/users/search');

    await page.getByLabel('Email').fill('test');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('Search Results')).toBeVisible();

    await page.getByRole('button', { name: 'Clear' }).click();

    await expect(page.getByText('Search Results')).toBeHidden();
    await expect(page.getByLabel('Email')).toHaveValue('');
  });

  test('should navigate to detail page on view button click', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockSearchUsers(page);
    await page.goto('/users/search');

    await page.getByRole('button', { name: 'Search' }).click();

    const row = page.getByRole('row', { name: /admin@example\.com/ });
    await row.locator('button', { has: page.locator('mat-icon', { hasText: 'visibility' }) }).click();

    await expect(page).toHaveURL(/.*\/users\/1$/);
  });

  test('should navigate to edit page on edit button click', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockSearchUsers(page);
    await page.goto('/users/search');

    await page.getByRole('button', { name: 'Search' }).click();

    const row = page.getByRole('row', { name: /admin@example\.com/ });
    await row.locator('button', { has: page.locator('mat-icon', { hasText: 'edit' }) }).click();

    await expect(page).toHaveURL(/.*\/users\/1\/edit$/);
  });

  test('should send isAdmin=true when "Admin" role is selected', async ({
    mockApi: page
  }) => {
    const capturedUrls: string[] = [];
    await loginViaUi(page, { isAdmin: true });
    await mockSearchUsersWithCapture(page, capturedUrls);
    await page.goto('/users/search');

    await page.getByLabel('Role').click();
    await page.getByRole('option', { name: 'Admin' }).click();
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('Search Results')).toBeVisible();
    expect(capturedUrls[0]).toContain('isAdmin=true');
  });

  test('should send isActive=true when "Active" status is selected', async ({
    mockApi: page
  }) => {
    const capturedUrls: string[] = [];
    await loginViaUi(page, { isAdmin: true });
    await mockSearchUsersWithCapture(page, capturedUrls);
    await page.goto('/users/search');

    await page.getByLabel('Status').click();
    await page.getByRole('option', { name: 'Active', exact: true }).click();
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('Search Results')).toBeVisible();
    expect(capturedUrls[0]).toContain('isActive=true');
  });

  test('should delete user from results with confirmation', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockSearchUsers(page);
    await mockDeleteUser(page);
    await page.goto('/users/search');

    await page.getByRole('button', { name: 'Search' }).click();

    const row = page.getByRole('row', { name: /john@example\.com/ });
    await row.locator('button', { has: page.locator('mat-icon', { hasText: 'delete' }) }).click();

    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('User deleted successfully')).toBeVisible();
  });
});
