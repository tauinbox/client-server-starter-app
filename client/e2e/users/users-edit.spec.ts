import {
  expect,
  expectAuthRedirect,
  loginViaUi,
  mockDeleteUser,
  mockGetUser,
  mockUpdateUser,
  mockUpdateUserError,
  mockUsersList,
  test
} from '../fixtures/base.fixture';

test.describe('User Edit page', () => {
  test('should redirect to login when not authenticated', async ({
    mockApi: page
  }) => {
    await expectAuthRedirect(page, '/users/1/edit');
  });

  test('should populate form with user data', async ({ mockApi: page }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
    await page.goto('/users/1/edit');

    await expect(page.getByLabel('Email')).toHaveValue('admin@example.com');
    await expect(page.getByLabel('First Name')).toHaveValue('Admin');
    await expect(page.getByLabel('Last Name')).toHaveValue('User');
  });

  test('should show admin checkboxes when logged in as admin', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
    await page.goto('/users/1/edit');

    await expect(page.getByLabel('Administrator')).toBeVisible();
    await expect(page.getByLabel('Active')).toBeVisible();
  });

  test('should not show admin checkboxes when logged in as non-admin', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: false });
    await mockGetUser(page, mockUsersList[1]);
    await page.goto('/users/2/edit');

    await expect(page.getByLabel('Administrator')).toBeHidden();
    await expect(page.getByLabel('Active')).toBeHidden();
  });

  test('should show "Delete User" button for admin editing another user', async ({
    mockApi: page
  }) => {
    // Login as user id=1 (admin), edit user id=2
    await loginViaUi(page, { id: '1', isAdmin: true });
    await mockGetUser(page, mockUsersList[1]);
    await page.goto('/users/2/edit');

    await expect(
      page.getByRole('button', { name: 'Delete User' })
    ).toBeVisible();
  });

  test('should not show "Delete User" button for admin editing self', async ({
    mockApi: page
  }) => {
    // Login as user id=1 (admin), edit user id=1 (self)
    await loginViaUi(page, { id: '1', isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
    await page.goto('/users/1/edit');

    await expect(
      page.getByRole('button', { name: 'Delete User' })
    ).toBeHidden();
  });

  test('should not show "Delete User" button for non-admin', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { id: '2', isAdmin: false });
    await mockGetUser(page, mockUsersList[1]);
    await page.goto('/users/2/edit');

    await expect(
      page.getByRole('button', { name: 'Delete User' })
    ).toBeHidden();
  });

  test('should disable Save button when form is pristine', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
    await page.goto('/users/1/edit');

    await expect(
      page.getByRole('button', { name: 'Save Changes' })
    ).toBeDisabled();
  });

  test('should enable Save button when form is dirty and valid', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
    await page.goto('/users/1/edit');

    await page.getByLabel('First Name').fill('Updated');

    await expect(
      page.getByRole('button', { name: 'Save Changes' })
    ).toBeEnabled();
  });

  test('should disable Save button when email is empty', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
    await page.goto('/users/1/edit');

    await page.getByLabel('Email').clear();

    await expect(
      page.getByRole('button', { name: 'Save Changes' })
    ).toBeDisabled();
  });

  test('should disable Save button when firstName is empty', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
    await page.goto('/users/1/edit');

    await page.getByLabel('First Name').clear();

    await expect(
      page.getByRole('button', { name: 'Save Changes' })
    ).toBeDisabled();
  });

  test('should disable Save button when lastName is empty', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
    await page.goto('/users/1/edit');

    await page.getByLabel('Last Name').clear();

    await expect(
      page.getByRole('button', { name: 'Save Changes' })
    ).toBeDisabled();
  });

  test('should disable Save button when password is too short', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
    await page.goto('/users/1/edit');

    await page.getByLabel('New Password (Optional)').fill('short');

    await expect(
      page.getByRole('button', { name: 'Save Changes' })
    ).toBeDisabled();
  });

  test('should show validation errors on blur', async ({ mockApi: page }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
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

  test('should update user successfully', async ({ mockApi: page }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
    await mockUpdateUser(page, { ...mockUsersList[0], firstName: 'Updated' });
    await page.goto('/users/1/edit');

    await page.getByLabel('First Name').fill('Updated');
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.getByText('User updated successfully')).toBeVisible();
    await expect(page).toHaveURL(/.*\/users\/1$/);
  });

  test('should show error message on update failure', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { isAdmin: true });
    await mockGetUser(page, mockUsersList[0]);
    await mockUpdateUserError(page);
    await page.goto('/users/1/edit');

    await page.getByLabel('First Name').fill('Updated');
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.locator('.error-message')).toBeVisible();
  });

  test('should show confirmation dialog on "Delete User" click', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { id: '1', isAdmin: true });
    await mockGetUser(page, mockUsersList[1]);
    await page.goto('/users/2/edit');

    await page.getByRole('button', { name: 'Delete User' }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Confirm Delete')).toBeVisible();
  });

  test('should delete and redirect to /users on confirm', async ({
    mockApi: page
  }) => {
    await loginViaUi(page, { id: '1', isAdmin: true });
    await mockGetUser(page, mockUsersList[1]);
    await mockDeleteUser(page);
    await page.goto('/users/2/edit');

    await page.getByRole('button', { name: 'Delete User' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('User deleted successfully')).toBeVisible();
    await expect(page).toHaveURL(/.*\/users$/);
  });
});
