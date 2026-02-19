import { expect, test } from '../fixtures/base.fixture';

test.describe('Password reset', () => {
  test('should display forgot password form', async ({ _mockServer, page }) => {
    await page.goto('/forgot-password');

    await expect(page.getByText('Forgot Password')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /send reset link/i })
    ).toBeVisible();
  });

  test('should navigate to forgot-password from login', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/login');

    await page.getByRole('link', { name: /forgot password/i }).click();

    await expect(page).toHaveURL(/.*\/forgot-password$/);
  });

  test('should submit forgot password and show success message', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/forgot-password');

    await page.getByLabel('Email').fill('user@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    // Should show success state
    await expect(page.getByText(/check your email/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /back to login/i })
    ).toBeVisible();
  });

  test('should show success even for non-existent email (anti-enumeration)', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/forgot-password');

    await page.getByLabel('Email').fill('nonexistent@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    await expect(page.getByText(/check your email/i)).toBeVisible();
  });

  test('should reset password via token and login with new password', async ({
    _mockServer,
    page
  }) => {
    // Trigger forgot-password to generate a reset token
    await fetch(`${_mockServer.url}/api/v1/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' })
    });

    // Get the reset token from control endpoint
    const tokens = await _mockServer.getTokens();
    const resetTokens = tokens.passwordResetTokens;
    // user@example.com has id '2'
    const tokenEntry = Object.entries(resetTokens).find(
      ([, userId]) => userId === '2'
    );
    expect(tokenEntry).toBeTruthy();
    const token = tokenEntry![0];

    // Navigate to reset-password with the token
    await page.goto(`/reset-password?token=${token}`);

    // Should show the password form
    await expect(page.getByLabel('New Password')).toBeVisible();

    // Enter new password and confirm
    await page.getByLabel('New Password').fill('NewPassword123');
    await page.getByLabel('Confirm Password').fill('NewPassword123');
    await page.getByRole('button', { name: /reset password/i }).click();

    // Should redirect to login
    await expect(page).toHaveURL(/.*\/login$/);

    // Login with the new password
    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('user@example.com');
    await page.getByLabel('Password').fill('NewPassword123');
    await main.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/.*\/profile$/);
  });

  test('should show error for invalid reset token', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/reset-password?token=invalid-token-xyz');

    // The component sends the token to the server on submit, but first checks
    // if token is present. Let's fill in the password and submit.
    await expect(page.getByLabel('New Password')).toBeVisible();
    await page.getByLabel('New Password').fill('NewPassword123');
    await page.getByLabel('Confirm Password').fill('NewPassword123');
    await page.getByRole('button', { name: /reset password/i }).click();

    // Should show error
    await expect(page.getByText(/invalid or expired/i)).toBeVisible();
  });

  test('should validate minimum password length on reset form', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/reset-password?token=some-token');

    await page.getByLabel('New Password').fill('short');
    // Blur to trigger validation
    await page.getByText('Reset Password').first().click();

    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
  });

  test('should show error when passwords do not match', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/reset-password?token=some-token');

    await page.getByLabel('New Password').fill('NewPassword123');
    await page.getByLabel('Confirm Password').fill('DifferentPassword1');
    // Blur to trigger validation
    await page.getByText('Reset Password').first().click();

    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });

  test('should reject login with old password after reset', async ({
    _mockServer,
    page
  }) => {
    // Trigger forgot-password
    await fetch(`${_mockServer.url}/api/v1/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' })
    });

    // Get the reset token
    const tokens = await _mockServer.getTokens();
    const tokenEntry = Object.entries(tokens.passwordResetTokens).find(
      ([, userId]) => userId === '2'
    );
    const token = tokenEntry![0];

    // Reset password via API
    await fetch(`${_mockServer.url}/api/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: 'NewPassword456' })
    });

    // Try to login with old password
    await page.goto('/login');
    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('user@example.com');
    await page.getByLabel('Password').fill('Password1');
    await main.getByRole('button', { name: 'Login' }).click();

    // Should fail
    await expect(page.getByText('Invalid credentials')).toBeVisible();
  });
});
