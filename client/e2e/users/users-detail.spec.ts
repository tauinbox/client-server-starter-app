import {
  expect,
  loginViaUi,
  mockGetUser,
  mockGetUserError,
  mockUsersList,
  test
} from '../fixtures/base.fixture';

test.describe('User Detail page', () => {
  test('should redirect to login when not authenticated', async ({
    mockApi: page
  }) => {
    await page.goto('/users/1');

    await expect(page).toHaveURL(/.*\/login/);
  });

  test('should allow non-admin authenticated users', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: false });
    await mockGetUser(page, mockUsersList[1]);
    await page.goto('/users/2');

    await expect(page.getByText('User Details')).toBeVisible();
  });

  test('should display user name and email', async ({ mockApi: page }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
    await page.goto('/users/1');

    await expect(page.locator('h2', { hasText: 'Admin User' })).toBeVisible();
    await expect(page.getByText('admin@example.com')).toBeVisible();
  });

  test('should display Active chip for active user', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, { isActive: true });
    await page.goto('/users/1');

    await expect(page.locator('.chips').getByText('Active')).toBeVisible();
  });

  test('should display Inactive chip for inactive user', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, { isActive: false });
    await page.goto('/users/1');

    await expect(page.locator('.chips').getByText('Inactive')).toBeVisible();
  });

  test('should display Administrator chip for admin user', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, { isAdmin: true });
    await page.goto('/users/1');

    await expect(page.locator('.chips').getByText('Administrator')).toBeVisible();
  });

  test('should display User chip for non-admin user', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, { isAdmin: false });
    await page.goto('/users/1');

    await expect(page.locator('.chips').getByText('User')).toBeVisible();
  });

  test('should display User ID, Created On, Last Updated', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
    await page.goto('/users/1');

    await expect(page.getByText('User ID')).toBeVisible();
    await expect(page.getByText('Created On')).toBeVisible();
    await expect(page.getByText('Last Updated')).toBeVisible();
  });

  test('should show "Edit User" button', async ({ mockApi: page }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
    await page.goto('/users/1');

    await expect(
      page.getByRole('button', { name: 'Edit User' })
    ).toBeVisible();
  });

  test('should navigate to edit page on "Edit User" button click', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
    await page.goto('/users/1');

    await page.getByRole('button', { name: 'Edit User' }).click();

    await expect(page).toHaveURL(/.*\/users\/1\/edit$/);
  });

  test('should show back button when viewed user is admin', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, { isAdmin: true });
    await page.goto('/users/1');

    await expect(
      page.locator('mat-card-header button', { has: page.locator('mat-icon', { hasText: 'arrow_back' }) })
    ).toBeVisible();
  });

  test('should not show back button when viewed user is not admin', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, { isAdmin: false });
    await page.goto('/users/1');

    await expect(
      page.locator('mat-card-header button', { has: page.locator('mat-icon', { hasText: 'arrow_back' }) })
    ).toBeHidden();
  });

  test('should show "User Not Found" when API returns 404', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUserError(page, 404);
    await page.goto('/users/999');

    await expect(page.getByRole('heading', { name: 'User Not Found' })).toBeVisible();
  });
});
