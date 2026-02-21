import { expect, test } from '../fixtures/base.fixture';

test.describe('Login page', () => {
  test('should display the login form', async ({ _mockServer, page }) => {
    await page.goto('/login');

    const main = page.getByRole('main');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Login' })).toBeVisible();
  });

  test('should disable submit button when form is invalid', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/login');

    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Login' })).toBeDisabled();
  });

  test('should login successfully and redirect to profile', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/login');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('user@example.com');
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await main.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/.*\/profile$/);
    await expect(page.getByText('Name: Regular User')).toBeVisible();
  });

  test('should show error on invalid credentials', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/login');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('wrong@example.com');
    await page.getByLabel('Password', { exact: true }).fill('wrongpassword');
    await main.getByRole('button', { name: 'Login' }).click();

    await expect(page.locator('.error-message')).toBeVisible();
  });
});
