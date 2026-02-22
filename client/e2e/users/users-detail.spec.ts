import {
  expect,
  expectAuthRedirect,
  loginViaUi,
  test
} from '../fixtures/base.fixture';

test.describe('User Detail page', () => {
  test('should redirect to login when not authenticated', async ({
    _mockServer,
    page
  }) => {
    await expectAuthRedirect(page, '/users/1');
  });

  test('should redirect non-admin users to forbidden', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {});
    await page.goto('/users/3');

    await expect(page).toHaveURL(/.*\/forbidden$/);
  });

  test('should display user name and email', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1');

    await expect(page.locator('h2', { hasText: 'Admin User' })).toBeVisible();
    await expect(page.getByText('admin@example.com')).toBeVisible();
  });

  test('should display Active chip for active user', async ({
    _mockServer,
    page
  }) => {
    await _mockServer.seedUsers([
      {
        id: '50',
        email: 'target@example.com',
        firstName: 'Target',
        lastName: 'User',
        password: 'Password1',
        isActive: true,
        roles: ['user'],
        isEmailVerified: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z'
      }
    ]);
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/50');

    await expect(page.locator('.chips').getByText('Active')).toBeVisible();
  });

  test('should display Inactive chip for inactive user', async ({
    _mockServer,
    page
  }) => {
    await _mockServer.seedUsers([
      {
        id: '50',
        email: 'target@example.com',
        firstName: 'Target',
        lastName: 'User',
        password: 'Password1',
        isActive: false,
        roles: ['user'],
        isEmailVerified: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z'
      }
    ]);
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/50');

    await expect(page.locator('.chips').getByText('Inactive')).toBeVisible();
  });

  test('should display Administrator chip for admin user', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1');

    await expect(
      page.locator('.chips').getByText('Administrator')
    ).toBeVisible();
  });

  test('should display User chip for non-admin user', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/3');

    await expect(page.locator('.chips').getByText('User')).toBeVisible();
  });

  test('should display User ID, Created On, Last Updated', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1');

    await expect(page.getByText('User ID')).toBeVisible();
    await expect(page.getByText('Created On')).toBeVisible();
    await expect(page.getByText('Last Updated')).toBeVisible();
  });

  test('should show "Edit User" button', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1');

    await expect(page.getByRole('button', { name: 'Edit User' })).toBeVisible();
  });

  test('should navigate to edit page on "Edit User" button click', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1');

    await page.getByRole('button', { name: 'Edit User' }).click();

    await expect(page).toHaveURL(/.*\/users\/1\/edit$/);
  });

  test('should show back button when logged in as admin', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/3');

    await expect(
      page.locator('mat-card-header button', {
        has: page.locator('mat-icon', { hasText: 'arrow_back' })
      })
    ).toBeVisible();
  });

  test('should redirect non-admin to forbidden when viewing user detail', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {});
    await page.goto('/users/3');

    await expect(page).toHaveURL(/.*\/forbidden$/);
  });

  test('should show "User Not Found" when API returns 404', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/999');

    await expect(
      page.getByRole('heading', { name: 'User Not Found' })
    ).toBeVisible();
  });
});
