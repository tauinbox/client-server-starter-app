import {
  expect,
  loginViaUi,
  mockProfile,
  mockUpdateUser,
  test
} from '../fixtures/base.fixture';

test.describe('Profile page', () => {
  test('should redirect to login when not authenticated', async ({
    mockApi: page
  }) => {
    await page.goto('/profile');

    await expect(page).toHaveURL(/.*\/login/);
  });

  test('should display account information after login', async ({
    mockApi: page
  }) => {
    await loginViaUi(page);

    await expect(page.getByText('My Profile')).toBeVisible();
    await expect(page.getByText('Email: test@example.com')).toBeVisible();
    await expect(page.getByText('Name: John Doe')).toBeVisible();
    await expect(page.getByText('Role: User')).toBeVisible();
    await expect(page.getByText('Status: Active')).toBeVisible();
    await expect(page.getByText('Member Since:')).toBeVisible();
  });

  test('should display admin role for admin user', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });

    await expect(page.getByText('Role: Administrator')).toBeVisible();
  });

  test('should display inactive status', async ({ mockApi: page }) => {
    await loginViaUi(page, { isActive: false });

    await expect(page.getByText('Status: Inactive')).toBeVisible();
  });

  test('should populate form with current user data', async ({
    mockApi: page
  }) => {
    await loginViaUi(page);

    await expect(page.getByLabel('First Name')).toHaveValue('John');
    await expect(page.getByLabel('Last Name')).toHaveValue('Doe');
    await expect(page.getByLabel('New Password (Optional)')).toHaveValue('');
  });

  test('should disable submit button when form is pristine', async ({
    mockApi: page
  }) => {
    await loginViaUi(page);

    await expect(
      page.getByRole('button', { name: 'Update Profile' })
    ).toBeDisabled();
  });

  test('should enable submit button when form is dirty and valid', async ({
    mockApi: page
  }) => {
    await loginViaUi(page);

    await page.getByLabel('First Name').fill('Jane');

    await expect(
      page.getByRole('button', { name: 'Update Profile' })
    ).toBeEnabled();
  });

  test('should disable submit button when first name is empty', async ({
    mockApi: page
  }) => {
    await loginViaUi(page);

    await page.getByLabel('First Name').clear();

    await expect(
      page.getByRole('button', { name: 'Update Profile' })
    ).toBeDisabled();
  });

  test('should disable submit button when last name is empty', async ({
    mockApi: page
  }) => {
    await loginViaUi(page);

    await page.getByLabel('Last Name').clear();

    await expect(
      page.getByRole('button', { name: 'Update Profile' })
    ).toBeDisabled();
  });

  test('should disable submit button with short password', async ({
    mockApi: page
  }) => {
    await loginViaUi(page);

    await page.getByLabel('New Password (Optional)').fill('short');

    await expect(
      page.getByRole('button', { name: 'Update Profile' })
    ).toBeDisabled();
  });

  test('should allow submitting with valid password', async ({
    mockApi: page
  }) => {
    await loginViaUi(page);

    await page.getByLabel('New Password (Optional)').fill('newpass123');

    await expect(
      page.getByRole('button', { name: 'Update Profile' })
    ).toBeEnabled();
  });

  test('should update profile successfully', async ({ mockApi: page }) => {
    await loginViaUi(page);
    await mockUpdateUser(page, { firstName: 'Jane', lastName: 'Smith' });

    await page.getByLabel('First Name').fill('Jane');
    await page.getByLabel('Last Name').fill('Smith');
    await page.getByRole('button', { name: 'Update Profile' }).click();

    await expect(
      page.getByText('Profile updated successfully')
    ).toBeVisible();
  });

  test('should show updated info after successful update', async ({
    mockApi: page
  }) => {
    await loginViaUi(page);
    await mockUpdateUser(page, { firstName: 'Jane', lastName: 'Smith' });
    // Re-mock profile to return updated data for subsequent loads
    await mockProfile(page, { firstName: 'Jane', lastName: 'Smith' });

    await page.getByLabel('First Name').fill('Jane');
    await page.getByLabel('Last Name').fill('Smith');
    await page.getByRole('button', { name: 'Update Profile' }).click();

    await expect(page.getByText('Name: Jane Smith')).toBeVisible();
  });

  test('should disable submit button after successful update', async ({
    mockApi: page
  }) => {
    await loginViaUi(page);
    await mockUpdateUser(page, { firstName: 'Jane' });

    await page.getByLabel('First Name').fill('Jane');
    await page.getByRole('button', { name: 'Update Profile' }).click();

    await expect(
      page.getByText('Profile updated successfully')
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Update Profile' })
    ).toBeDisabled();
  });

  test('should show error on update failure', async ({ mockApi: page }) => {
    await loginViaUi(page);
    // Mock update to fail
    await page.route('**/api/v1/users/*', (route) => {
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
    mockApi: page
  }) => {
    await loginViaUi(page);

    await page.getByLabel('First Name').clear();
    await page.getByLabel('Last Name').click();

    await expect(page.getByText('First name is required')).toBeVisible();
  });

  test('should show validation error for empty last name', async ({
    mockApi: page
  }) => {
    await loginViaUi(page);

    await page.getByLabel('Last Name').clear();
    await page.getByLabel('First Name').click();

    await expect(page.getByText('Last name is required')).toBeVisible();
  });

  test('should show password validation error', async ({ mockApi: page }) => {
    await loginViaUi(page);

    await page.getByLabel('New Password (Optional)').fill('short');
    await page.getByLabel('First Name').click();

    await expect(
      page.getByText('Password must be at least 8 characters')
    ).toBeVisible();
  });
});
