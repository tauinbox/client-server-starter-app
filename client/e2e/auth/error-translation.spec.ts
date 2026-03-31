import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import { ErrorKeys } from '@app/shared/constants/error-keys';

// These tests verify that when the server returns an `errorKey` in the error
// response, the client shows the translated text (not the raw English `message`).
// Each test uses a distinguishable raw `message` value so we can assert the
// translated key path was taken, not the message-fallback path.

const RAW_MSG = 'RAW_SERVER_MESSAGE_SHOULD_NOT_BE_VISIBLE';

test.describe('Error translation: login component errors', () => {
  test('should use errorKey translation for 401 invalid credentials', async ({
    page,
    _mockServer
  }) => {
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          message: RAW_MSG,
          errorKey: ErrorKeys.AUTH.INVALID_CREDENTIALS,
          statusCode: 401
        })
      })
    );

    await page.goto('/login');
    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Email').blur();
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await page.getByLabel('Password', { exact: true }).blur();
    await main.getByRole('button', { name: 'Login' }).click();

    await expect(page.locator('.error-message')).toContainText(
      'Invalid credentials'
    );
    await expect(page.getByText(RAW_MSG)).not.toBeVisible();
  });

  test('should use errorKey translation for 423 account lockout', async ({
    page,
    _mockServer
  }) => {
    const lockedUntil = new Date(Date.now() + 60_000).toISOString();
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        status: 423,
        contentType: 'application/json',
        body: JSON.stringify({
          message: RAW_MSG,
          errorKey: ErrorKeys.AUTH.ACCOUNT_LOCKED,
          retryAfter: 60,
          lockedUntil
        })
      })
    );

    await page.goto('/login');
    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Email').blur();
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await page.getByLabel('Password', { exact: true }).blur();
    await main.getByRole('button', { name: 'Login' }).click();

    await expect(page.locator('.error-message')).toContainText(
      'temporarily locked'
    );
    await expect(page.getByText(RAW_MSG)).not.toBeVisible();
  });

  test('should use errorKey translation for 403 email not verified', async ({
    page,
    _mockServer
  }) => {
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          message: RAW_MSG,
          errorCode: 'EMAIL_NOT_VERIFIED',
          errorKey: ErrorKeys.AUTH.EMAIL_NOT_VERIFIED
        })
      })
    );
    // Permissions re-fetch (triggered by error interceptor on 403) should fail
    // silently with 401 since there's no active session
    await page.route('**/api/v1/auth/permissions', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' })
      })
    );

    await page.goto('/login');
    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Email').blur();
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await page.getByLabel('Password', { exact: true }).blur();
    await main.getByRole('button', { name: 'Login' }).click();

    await expect(page.locator('.error-message')).toContainText(
      'verify your email'
    );
    await expect(page.getByText(RAW_MSG)).not.toBeVisible();
  });
});

test.describe('Error translation: register component errors', () => {
  test('should use errorKey translation for non-409 server error', async ({
    page,
    _mockServer
  }) => {
    await page.route('**/api/v1/auth/register', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          message: RAW_MSG,
          errorKey: ErrorKeys.GENERAL.INTERNAL_SERVER_ERROR,
          statusCode: 500
        })
      })
    );

    await page.goto('/register');
    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Email').blur();
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('First Name').blur();
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Last Name').blur();
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await main.getByRole('button', { name: 'Register' }).click();

    await expect(page.locator('.error-message')).toContainText(
      'Internal server error'
    );
    await expect(page.getByText(RAW_MSG)).not.toBeVisible();
  });
});

test.describe('Error translation: global error interceptor → snackbar', () => {
  test('should show translated text in snackbar from server errorKey', async ({
    page,
    _mockServer
  }) => {
    // Login via UI so we can reach the profile page.
    // auth.service login/register/forgotPassword etc. all use silentContext()
    // which suppresses the snackbar — so we use the profile-update endpoint
    // (PATCH /auth/profile) which is NOT silenced and goes through the global
    // error interceptor.
    await loginViaUi(page, _mockServer.url);

    // Intercept only PATCH /auth/profile; let other profile requests through.
    await page.route('**/api/v1/auth/profile', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            message: RAW_MSG,
            errorKey: ErrorKeys.GENERAL.INTERNAL_SERVER_ERROR,
            statusCode: 500
          })
        });
      } else {
        await route.fallback();
      }
    });

    // Make the form dirty and submit.
    await page.getByLabel('First Name').fill('Updated');
    await page.getByLabel('First Name').blur();
    await page.getByRole('button', { name: 'Update Profile' }).click();

    const snackbar = page.locator('mat-snack-bar-container');
    await expect(snackbar).toBeVisible({ timeout: 5000 });
    await expect(snackbar).toContainText('Internal server error');
    // The snackbar must show the translated key, not the raw server message.
    await expect(snackbar).not.toContainText(RAW_MSG);
  });
});
