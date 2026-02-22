import {
  expect,
  expectAuthRedirect,
  loginViaUi,
  test
} from '../fixtures/base.fixture';

test.describe('Profile page', () => {
  test('should redirect to login when not authenticated', async ({
    _mockServer,
    page
  }) => {
    await expectAuthRedirect(page, '/profile');
  });

  test('should display account information after login', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await expect(page.getByText('My Profile')).toBeVisible();
    await expect(page.getByText('Email: testlogin@example.com')).toBeVisible();
    await expect(page.getByText('Name: John Doe')).toBeVisible();
    await expect(page.getByText('Role: User')).toBeVisible();
    await expect(page.getByText('Status: Active')).toBeVisible();
    await expect(page.getByText('Member Since:')).toBeVisible();
  });

  test('should display admin role for admin user', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    await expect(page.getByText('Role: Administrator')).toBeVisible();
  });

  test('should display inactive status', async ({ _mockServer, page }) => {
    // Login as active user first, then intercept profile response as inactive
    await loginViaUi(page, _mockServer.url);

    // Intercept GET /api/v1/auth/profile to return inactive status
    await page.route('**/api/v1/auth/profile', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: '100',
            email: 'testlogin@example.com',
            firstName: 'John',
            lastName: 'Doe',
            isActive: false,
            roles: ['user'],
            isEmailVerified: true,
            failedLoginAttempts: 0,
            lockedUntil: null,
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z'
          })
        });
      }
      return route.fallback();
    });

    // Reload profile page to get the intercepted response
    await page.goto('/profile');
    await expect(page.getByText('Status: Inactive')).toBeVisible();
  });

  test('should populate form with current user data', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await expect(page.getByLabel('First Name')).toHaveValue('John');
    await expect(page.getByLabel('Last Name')).toHaveValue('Doe');
    await expect(page.getByLabel('New Password (Optional)')).toHaveValue('');
  });

  test('should disable submit button when form is pristine', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await expect(
      page.getByRole('button', { name: 'Update Profile' })
    ).toBeDisabled();
  });

  test('should enable submit button when form is dirty and valid', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('First Name').fill('Jane');

    await expect(
      page.getByRole('button', { name: 'Update Profile' })
    ).toBeEnabled();
  });

  test('should disable submit button when first name is empty', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('First Name').clear();

    await expect(
      page.getByRole('button', { name: 'Update Profile' })
    ).toBeDisabled();
  });

  test('should disable submit button when last name is empty', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('Last Name').clear();

    await expect(
      page.getByRole('button', { name: 'Update Profile' })
    ).toBeDisabled();
  });

  test('should disable submit button with short password', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('New Password (Optional)').fill('short');

    await expect(
      page.getByRole('button', { name: 'Update Profile' })
    ).toBeDisabled();
  });

  test('should allow submitting with valid password and matching confirm', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('New Password (Optional)').fill('newpass123');
    await page.getByLabel('Confirm New Password').fill('newpass123');

    await expect(
      page.getByRole('button', { name: 'Update Profile' })
    ).toBeEnabled();
  });

  test('should disable submit when passwords do not match', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('New Password (Optional)').fill('newpass123');
    await page.getByLabel('Confirm New Password').fill('different1');
    await page.getByLabel('First Name').click();

    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Update Profile' })
    ).toBeDisabled();
  });

  test('should update profile successfully', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('First Name').fill('Jane');
    await page.getByLabel('Last Name').fill('Smith');
    await page.getByRole('button', { name: 'Update Profile' }).click();

    await expect(page.getByText('Profile updated successfully')).toBeVisible();
  });

  test('should show updated info after successful update', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('First Name').fill('Jane');
    await page.getByLabel('Last Name').fill('Smith');
    await page.getByRole('button', { name: 'Update Profile' }).click();

    await expect(page.getByText('Name: Jane Smith')).toBeVisible();
  });

  test('should disable submit button after successful update', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('First Name').fill('Jane');
    await page.getByRole('button', { name: 'Update Profile' }).click();

    await expect(page.getByText('Profile updated successfully')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Update Profile' })
    ).toBeDisabled();
  });

  test('should show error on update failure', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url);
    // Intercept PATCH profile to return 500
    await page.route('**/api/v1/auth/profile', (route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Failed to update profile',
            statusCode: 500
          })
        });
      }
      return route.fallback();
    });

    await page.getByLabel('First Name').fill('Jane');
    await page.getByRole('button', { name: 'Update Profile' }).click();

    await expect(page.locator('.error-message')).toBeVisible();
  });

  test('should show validation error for empty first name', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('First Name').clear();
    await page.getByLabel('Last Name').click();

    await expect(page.getByText('First name is required')).toBeVisible();
  });

  test('should show validation error for empty last name', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('Last Name').clear();
    await page.getByLabel('First Name').click();

    await expect(page.getByText('Last name is required')).toBeVisible();
  });

  test('should show password validation error', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.getByLabel('New Password (Optional)').fill('short');
    await page.getByLabel('First Name').click();

    await expect(
      page.getByText('Password must be at least 8 characters')
    ).toBeVisible();
  });
});
