import { expect, test } from '../fixtures/base.fixture';

test.describe('Email verification', () => {
  test('should register and then verify email via token', async ({
    _mockServer,
    page
  }) => {
    // Register a new user
    await page.goto('/register');
    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('verify-test@example.com');
    await page.getByLabel('First Name').fill('Verify');
    await page.getByLabel('Last Name').fill('Test');
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await main.getByRole('button', { name: 'Register' }).click();

    // Should redirect to login with pending-verification
    await expect(page).toHaveURL(/.*\/login\?registered=pending-verification$/);

    // Get the verification token from the control endpoint
    const tokens = await _mockServer.getTokens();
    const verificationTokens = tokens.emailVerificationTokens;
    const token = Object.keys(verificationTokens)[0];
    expect(token).toBeTruthy();

    // Visit the verify-email page with the token
    await page.goto(`/verify-email?token=${token}`);

    // Should show success message
    await expect(page.getByText('Email Verified Successfully')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /go to login/i })
    ).toBeVisible();
  });

  test('should block login for unverified user', async ({
    _mockServer,
    page
  }) => {
    // Seed an unverified user
    await _mockServer.seedUsers([
      {
        id: '300',
        email: 'unverified@example.com',
        firstName: 'Unverified',
        lastName: 'User',
        password: 'Password1',
        isActive: true,
        roles: ['user'],
        isEmailVerified: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z'
      }
    ]);

    await page.goto('/login');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('unverified@example.com');
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await main.getByRole('button', { name: 'Login' }).click();

    // Should show email not verified error
    await expect(page.getByText(/verify your email/i)).toBeVisible();

    // Should show resend verification button
    await expect(
      page.getByRole('button', { name: /resend verification/i })
    ).toBeVisible();
  });

  test('should resend verification email', async ({ _mockServer, page }) => {
    // Seed an unverified user
    await _mockServer.seedUsers([
      {
        id: '301',
        email: 'resend@example.com',
        firstName: 'Resend',
        lastName: 'User',
        password: 'Password1',
        isActive: true,
        roles: ['user'],
        isEmailVerified: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z'
      }
    ]);

    await page.goto('/login');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('resend@example.com');
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await main.getByRole('button', { name: 'Login' }).click();

    // Wait for verification actions to appear
    await expect(
      page.getByRole('button', { name: /resend verification/i })
    ).toBeVisible();

    // Click resend
    await page.getByRole('button', { name: /resend verification/i }).click();

    // Should show confirmation message
    await expect(page.getByText(/verification email sent/i)).toBeVisible();
  });

  test('should show error for invalid verification token', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/verify-email?token=invalid-token-123');

    await expect(page.getByText('Verification Failed')).toBeVisible();
    await expect(page.getByText(/invalid or expired/i)).toBeVisible();
  });

  test('should allow login after email verification', async ({
    _mockServer,
    page
  }) => {
    // Seed an unverified user with a verification token
    await _mockServer.seedUsers([
      {
        id: '302',
        email: 'verifythenlogin@example.com',
        firstName: 'Verify',
        lastName: 'Login',
        password: 'Password1',
        isActive: true,
        roles: ['user'],
        isEmailVerified: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z'
      }
    ]);

    // Trigger a resend-verification to create a token
    await fetch(`${_mockServer.url}/api/v1/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'verifythenlogin@example.com' })
    });

    // Get the token
    const tokens = await _mockServer.getTokens();
    const verificationTokens = tokens.emailVerificationTokens;
    const tokenEntry = Object.entries(verificationTokens).find(
      ([, userId]) => userId === '302'
    );
    expect(tokenEntry).toBeTruthy();
    const token = tokenEntry![0];

    // Verify email
    await page.goto(`/verify-email?token=${token}`);
    await expect(page.getByText('Email Verified Successfully')).toBeVisible();

    // Navigate to login and log in
    await page.getByRole('button', { name: /go to login/i }).click();
    await expect(page).toHaveURL(/.*\/login$/);

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('verifythenlogin@example.com');
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await main.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/.*\/profile$/);
  });
});
