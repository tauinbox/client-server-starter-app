import { expect, test } from '../fixtures/base.fixture';

test.describe('Register page', () => {
  test('should display the registration form', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/register');

    const main = page.getByRole('main');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('First Name')).toBeVisible();
    await expect(page.getByLabel('Last Name')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Register' })).toBeVisible();
  });

  test('should disable submit button when form is empty', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/register');

    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Register' })).toBeDisabled();
  });

  test('should disable submit button with invalid email', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/register');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Password').fill('password123');

    await expect(main.getByRole('button', { name: 'Register' })).toBeDisabled();
  });

  test('should disable submit button with short password', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/register');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Password').fill('short');

    await expect(main.getByRole('button', { name: 'Register' })).toBeDisabled();
  });

  test('should enable submit button when form is valid', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/register');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Password').fill('password123');

    await expect(main.getByRole('button', { name: 'Register' })).toBeEnabled();
  });

  test('should show validation errors on touched empty fields', async ({
    _mockServer,
    page
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
    _mockServer,
    page
  }) => {
    await page.goto('/register');

    await page.getByLabel('Email').fill('invalid-email');
    await page.getByLabel('First Name').click();

    await expect(
      page.getByText('Please enter a valid email address')
    ).toBeVisible();
  });

  test('should show password min length error', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/register');

    await page.getByLabel('Password').fill('short');
    await page.getByLabel('Email').click();

    await expect(
      page.getByText('Password must be at least 8 characters')
    ).toBeVisible();
  });

  test('should register successfully and redirect to login with pending verification', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/register');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('newuser@example.com');
    await page.getByLabel('First Name').fill('Jane');
    await page.getByLabel('Last Name').fill('Smith');
    await page.getByLabel('Password').fill('Password1');
    await main.getByRole('button', { name: 'Register' }).click();

    await expect(page).toHaveURL(/.*\/login\?registered=pending-verification$/);
    await expect(
      page.getByText(/check your email to verify your account/i)
    ).toBeVisible();
  });

  test('should show error when email already exists', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/register');

    const main = page.getByRole('main');
    // admin@example.com exists in seed data
    await page.getByLabel('Email').fill('admin@example.com');
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Password').fill('Password1');
    await main.getByRole('button', { name: 'Register' }).click();

    await expect(
      page.getByText('User with this email already exists.')
    ).toBeVisible();
  });

  test('should show generic error on server failure', async ({
    _mockServer,
    page
  }) => {
    // Use page.route() to intercept and return 500 for this specific error test
    await page.route('**/api/v1/auth/register', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Internal server error',
          statusCode: 500
        })
      })
    );
    await page.goto('/register');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Password').fill('Password1');
    await main.getByRole('button', { name: 'Register' }).click();

    await expect(page.locator('.error-message')).toBeVisible();
  });

  test('should have a link to login page', async ({ _mockServer, page }) => {
    await page.goto('/register');

    const loginLink = page.getByRole('link', { name: 'Login' });
    await expect(loginLink).toBeVisible();
    await loginLink.click();

    await expect(page).toHaveURL(/.*\/login$/);
  });
});
