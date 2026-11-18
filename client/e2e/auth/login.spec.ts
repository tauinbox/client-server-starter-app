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

  test('shows no link to another region while no other site exists', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/login');

    await expect(page.getByRole('main').getByLabel('Email')).toBeVisible();
    await expect(page.getByText('Account in another region?')).toHaveCount(0);
  });

  test('links to the site of each other region, and an unknown email gets the usual answer', async ({
    _mockServer,
    page
  }) => {
    await _mockServer.setRegionPeers({ ru: 'https://ru.example.com' });
    await page.goto('/login');

    const main = page.getByRole('main');

    await expect(main.getByText('Account in another region?')).toBeVisible();
    await expect(
      main.getByRole('link', { name: 'Go to the site for Russia' })
    ).toHaveAttribute('href', 'https://ru.example.com');

    await page.getByLabel('Email').fill('resident@example.com');
    await page
      .getByLabel('Password', { exact: true })
      .fill('Sunrise-Kettle-19');
    await main.getByRole('button', { name: 'Login' }).click();

    await expect(page.locator('.error-message')).toHaveText(
      'Invalid credentials'
    );
    await expect(
      main.getByRole('link', { name: 'Go to the site for Russia' })
    ).toBeVisible();
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

  test('sends an admin to the admin panel after login', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/login');

    await page.getByLabel('Email').fill('admin@example.com');
    await page.getByLabel('Email').blur();
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await page.getByLabel('Password', { exact: true }).blur();
    await page.getByRole('main').getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByRole('link', { name: 'Admin panel' })).toBeVisible();
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

  // The mock has no rate limit, so the throttle answer of the server is
  // played back here with the body it sends: no errorKey.
  test('names a throttled sign-in instead of blaming the credentials', async ({
    _mockServer,
    page
  }) => {
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 429,
          message: 'ThrottlerException: Too Many Requests',
          error: 'Too Many Requests',
          path: '/api/v1/auth/login'
        })
      })
    );
    await page.goto('/login');

    const main = page.getByRole('main');

    await page.getByLabel('Email').fill('user@example.com');
    await page.getByLabel('Email').blur();
    await page
      .getByLabel('Password', { exact: true })
      .fill('Lantern-Orchard-47');
    await page.getByLabel('Password', { exact: true }).blur();
    await main.getByRole('button', { name: 'Login' }).click();

    await expect(page.locator('.error-message')).toHaveText(
      'Too many requests. Please slow down and try again.'
    );
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
