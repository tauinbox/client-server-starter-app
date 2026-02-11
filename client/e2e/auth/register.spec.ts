import {
  expect,
  mockRegister,
  mockRegisterError,
  test
} from '../fixtures/base.fixture';

test.describe('Register page', () => {
  test('should display the registration form', async ({ mockApi: page }) => {
    await page.goto('/register');

    const main = page.getByRole('main');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('First Name')).toBeVisible();
    await expect(page.getByLabel('Last Name')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(
      main.getByRole('button', { name: 'Register' })
    ).toBeVisible();
  });

  test('should disable submit button when form is empty', async ({
    mockApi: page
  }) => {
    await page.goto('/register');

    const main = page.getByRole('main');
    await expect(
      main.getByRole('button', { name: 'Register' })
    ).toBeDisabled();
  });

  test('should disable submit button with invalid email', async ({
    mockApi: page
  }) => {
    await page.goto('/register');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Password').fill('password123');

    await expect(
      main.getByRole('button', { name: 'Register' })
    ).toBeDisabled();
  });

  test('should disable submit button with short password', async ({
    mockApi: page
  }) => {
    await page.goto('/register');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Password').fill('short');

    await expect(
      main.getByRole('button', { name: 'Register' })
    ).toBeDisabled();
  });

  test('should enable submit button when form is valid', async ({
    mockApi: page
  }) => {
    await page.goto('/register');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Password').fill('password123');

    await expect(
      main.getByRole('button', { name: 'Register' })
    ).toBeEnabled();
  });

  test('should show validation errors on touched empty fields', async ({
    mockApi: page
  }) => {
    await page.goto('/register');

    // Touch fields by focusing and blurring
    await page.getByLabel('Email').click();
    await page.getByLabel('First Name').click();
    await page.getByLabel('Last Name').click();
    await page.getByLabel('Password').click();
    // Blur last field
    await page.getByLabel('Email').click();

    await expect(page.getByText('Email is required')).toBeVisible();
    await expect(page.getByText('First name is required')).toBeVisible();
    await expect(page.getByText('Last name is required')).toBeVisible();
    await expect(page.getByText('Password is required')).toBeVisible();
  });

  test('should show email validation error for invalid email', async ({
    mockApi: page
  }) => {
    await page.goto('/register');

    await page.getByLabel('Email').fill('invalid-email');
    await page.getByLabel('First Name').click();

    await expect(
      page.getByText('Please enter a valid email address')
    ).toBeVisible();
  });

  test('should show password min length error', async ({ mockApi: page }) => {
    await page.goto('/register');

    await page.getByLabel('Password').fill('short');
    await page.getByLabel('Email').click();

    await expect(
      page.getByText('Password must be at least 8 characters')
    ).toBeVisible();
  });

  test('should register successfully and redirect to login', async ({
    mockApi: page
  }) => {
    await mockRegister(page);
    await page.goto('/register');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('new@example.com');
    await page.getByLabel('First Name').fill('Jane');
    await page.getByLabel('Last Name').fill('Smith');
    await page.getByLabel('Password').fill('password123');
    await main.getByRole('button', { name: 'Register' }).click();

    await expect(page).toHaveURL(/.*\/login$/);
    await expect(
      page.getByText('Registration successful! Please login.')
    ).toBeVisible();
  });

  test('should show error when email already exists', async ({
    mockApi: page
  }) => {
    await mockRegisterError(page, 409, 'User with this email already exists');
    await page.goto('/register');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('existing@example.com');
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Password').fill('password123');
    await main.getByRole('button', { name: 'Register' }).click();

    await expect(
      page.getByText('User with this email already exists.')
    ).toBeVisible();
  });

  test('should show generic error on server failure', async ({
    mockApi: page
  }) => {
    await mockRegisterError(page, 500, 'Internal server error');
    await page.goto('/register');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Password').fill('password123');
    await main.getByRole('button', { name: 'Register' }).click();

    await expect(page.locator('.error-message')).toBeVisible();
  });

  test('should have a link to login page', async ({ mockApi: page }) => {
    await page.goto('/register');

    const loginLink = page.getByRole('link', { name: 'Login' });
    await expect(loginLink).toBeVisible();
    await loginLink.click();

    await expect(page).toHaveURL(/.*\/login$/);
  });
});
