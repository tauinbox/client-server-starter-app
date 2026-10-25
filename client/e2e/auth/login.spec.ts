import { expect, test } from '../fixtures/base.fixture';
import { createMockUser } from '../fixtures/mock-data';
import { mockId } from '../fixtures/ids';

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
    await page.getByLabel('Email').blur();
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await page.getByLabel('Password', { exact: true }).blur();
    await main.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/.*\/profile$/);
    await expect(
      page.getByRole('heading', { name: 'Regular User' })
    ).toBeVisible();
  });

  test('should show error on invalid credentials', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/login');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('wrong@example.com');
    await page.getByLabel('Email').blur();
    await page.getByLabel('Password', { exact: true }).fill('wrongpassword');
    await page.getByLabel('Password', { exact: true }).blur();
    await main.getByRole('button', { name: 'Login' }).click();

    await expect(page.locator('.error-message')).toBeVisible();
  });

  test('should stay on login with no session calls for an unverified user', async ({
    _mockServer,
    page
  }) => {
    await _mockServer.seedUsers([
      createMockUser({
        id: mockId('user-303'),
        email: 'unverified-login@example.com',
        name: 'Unverified Login',
        password: 'Password1',
        roles: ['user'],
        isEmailVerified: false
      })
    ]);
    const sessionCalls: string[] = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (
        pathname === '/api/v1/auth/permissions' ||
        pathname === '/api/v1/auth/refresh-token'
      ) {
        sessionCalls.push(pathname);
      }
    });

    await page.goto('/login');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('unverified-login@example.com');
    await page.getByLabel('Email').blur();
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await page.getByLabel('Password', { exact: true }).blur();
    await main.getByRole('button', { name: 'Login' }).click();

    await expect(page.getByText(/verify your email/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    expect(sessionCalls).toEqual([]);
  });
});
