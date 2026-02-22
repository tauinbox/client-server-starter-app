import {
  expect,
  expectAuthRedirect,
  loginViaUi,
  test
} from '../fixtures/base.fixture';

test.describe('User Edit page', () => {
  test('should redirect to login when not authenticated', async ({
    _mockServer,
    page
  }) => {
    await expectAuthRedirect(page, '/users/1/edit');
  });

  test('should populate form with user data', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');

    await expect(page.getByLabel('Email')).toHaveValue('admin@example.com');
    await expect(page.getByLabel('First Name')).toHaveValue('Admin');
    await expect(page.getByLabel('Last Name')).toHaveValue('User');
  });

  test('should show status checkbox when logged in as admin', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');

    await expect(page.getByLabel('Active')).toBeVisible();
  });

  test('should redirect non-admin to forbidden on edit page', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {});
    await page.goto('/users/3/edit');

    await expect(page).toHaveURL(/.*\/forbidden$/);
  });

  test('should show "Delete User" button for admin editing another user', async ({
    _mockServer,
    page
  }) => {
    // Login as user id=100 (admin), edit user id=3 (another user)
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/3/edit');

    await expect(
      page.getByRole('button', { name: 'Delete User' })
    ).toBeVisible();
  });

  test('should not show "Delete User" button for admin editing self', async ({
    _mockServer,
    page
  }) => {
    // Login as user id=100 (admin), edit user id=100 (self)
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/100/edit');

    await expect(
      page.getByRole('button', { name: 'Delete User' })
    ).toBeHidden();
  });

  test('should redirect non-admin to forbidden on edit self', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {});
    await page.goto('/users/100/edit');

    await expect(page).toHaveURL(/.*\/forbidden$/);
  });

  test('should disable Save button when form is pristine', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');

    await expect(
      page.getByRole('button', { name: 'Save Changes' })
    ).toBeDisabled();
  });

  test('should enable Save button when form is dirty and valid', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');

    await page.getByLabel('First Name').fill('Updated');

    await expect(
      page.getByRole('button', { name: 'Save Changes' })
    ).toBeEnabled();
  });

  test('should disable Save button when email is empty', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');

    await page.getByLabel('Email').clear();

    await expect(
      page.getByRole('button', { name: 'Save Changes' })
    ).toBeDisabled();
  });

  test('should disable Save button when firstName is empty', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');

    await page.getByLabel('First Name').clear();

    await expect(
      page.getByRole('button', { name: 'Save Changes' })
    ).toBeDisabled();
  });

  test('should disable Save button when lastName is empty', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');

    await page.getByLabel('Last Name').clear();

    await expect(
      page.getByRole('button', { name: 'Save Changes' })
    ).toBeDisabled();
  });

  test('should disable Save button when password is too short', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');

    await page.getByLabel('New Password (Optional)').fill('short');

    await expect(
      page.getByRole('button', { name: 'Save Changes' })
    ).toBeDisabled();
  });

  test('should show validation errors on blur', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');

    await page.getByLabel('Email').clear();
    await page.getByLabel('First Name').click();

    await expect(page.getByText('Email is required')).toBeVisible();

    await page.getByLabel('First Name').clear();
    await page.getByLabel('Last Name').click();

    await expect(page.getByText('First name is required')).toBeVisible();

    await page.getByLabel('Last Name').clear();
    await page.getByLabel('Email').click();

    await expect(page.getByText('Last name is required')).toBeVisible();
  });

  test('should update user successfully', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');

    await page.getByLabel('First Name').fill('Updated');
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.getByText('User updated successfully')).toBeVisible();
    await expect(page).toHaveURL(/.*\/users\/1$/);
  });

  test('should show error message on update failure', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    // Intercept PATCH to return 500
    await page.route('**/api/v1/users/*', (route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Failed to update user',
            statusCode: 500
          })
        });
      }
      return route.fallback();
    });
    await page.goto('/users/1/edit');

    await page.getByLabel('First Name').fill('Updated');
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.locator('.error-message')).toBeVisible();
  });

  test('should show confirmation dialog on "Delete User" click', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/3/edit');

    await page.getByRole('button', { name: 'Delete User' }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Confirm Delete')).toBeVisible();
  });

  test('should delete and redirect to /users on confirm', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/3/edit');

    await page.getByRole('button', { name: 'Delete User' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect(page.getByText('User deleted successfully')).toBeVisible();
    await expect(page).toHaveURL(/.*\/users$/);
  });
});
