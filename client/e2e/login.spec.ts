import {
  expect,
  mockLogin,
  mockLoginError,
  mockProfile,
  mockRefreshToken,
  test
} from './fixtures/base.fixture';

test.describe('Login page', () => {
  test('should display the login form', async ({ mockApi: page }) => {
    await page.goto('/login');

    const main = page.getByRole('main');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Login' })).toBeVisible();
  });

  test('should disable submit button when form is invalid', async ({
    mockApi: page
  }) => {
    await page.goto('/login');

    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Login' })).toBeDisabled();
  });

  test('should login successfully and redirect to profile', async ({
    mockApi: page
  }) => {
    await mockLogin(page);
    await mockRefreshToken(page);
    await mockProfile(page);
    await page.goto('/login');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Password').fill('password123');
    await main.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/.*\/profile$/);
    await expect(page.getByText('Name: John Doe')).toBeVisible();
  });

  test('should show error on invalid credentials', async ({
    mockApi: page
  }) => {
    await mockLoginError(page);
    await page.goto('/login');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('wrong@example.com');
    await page.getByLabel('Password').fill('wrongpassword');
    await main.getByRole('button', { name: 'Login' }).click();

    await expect(page.locator('.error-message')).toBeVisible();
  });
});
