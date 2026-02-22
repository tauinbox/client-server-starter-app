import { expect, loginViaUi, test } from '../fixtures/base.fixture';

test.describe('Account lockout', () => {
  test('should lock account after 5 failed login attempts', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/login');

    const main = page.getByRole('main');

    // Enter 5 wrong passwords
    for (let i = 0; i < 5; i++) {
      await page.getByLabel('Email').fill('user@example.com');
      await page.getByLabel('Password', { exact: true }).fill('WrongPassword');
      await main.getByRole('button', { name: 'Login' }).click();

      if (i < 4) {
        // First 4 attempts should show "Invalid credentials"
        await expect(page.getByText('Invalid credentials')).toBeVisible();
        // Clear error state for next attempt
        await page.getByLabel('Password', { exact: true }).clear();
      }
    }

    // 5th attempt triggers lockout (423 status)
    await expect(page.getByText(/temporarily locked/i)).toBeVisible();
    await expect(page.getByText(/Try again in/)).toBeVisible();
  });

  test('should prevent login while account is locked', async ({
    _mockServer,
    page
  }) => {
    // Seed a user that is already locked
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await _mockServer.seedUsers([
      {
        id: '200',
        email: 'locked@example.com',
        firstName: 'Locked',
        lastName: 'User',
        password: 'Password1',
        isActive: true,
        roles: ['user'],
        isEmailVerified: true,
        failedLoginAttempts: 5,
        lockedUntil,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z'
      }
    ]);

    await page.goto('/login');

    const main = page.getByRole('main');
    await page.getByLabel('Email').fill('locked@example.com');
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await main.getByRole('button', { name: 'Login' }).click();

    await expect(page.getByText(/temporarily locked/i)).toBeVisible();
    await expect(page.getByText(/Try again in/)).toBeVisible();
  });

  test('admin should unlock a locked account', async ({
    _mockServer,
    page
  }) => {
    // Seed a locked user
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await _mockServer.seedUsers([
      {
        id: '201',
        email: 'lockeduser@example.com',
        firstName: 'Locked',
        lastName: 'Account',
        password: 'Password1',
        isActive: true,
        roles: ['user'],
        isEmailVerified: true,
        failedLoginAttempts: 5,
        lockedUntil,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z'
      }
    ]);

    // Login as admin
    await loginViaUi(page, _mockServer.url, {
      id: '1',
      email: 'admin@example.com',
      roles: ['admin']
    });

    // Navigate to the locked user's edit page
    await page.goto('/users/201/edit');

    // Should see lockout status and unlock button
    await expect(page.getByRole('button', { name: /unlock/i })).toBeVisible();
    await page.getByRole('button', { name: /unlock/i }).click();

    // After unlock, the unlock button should disappear
    await expect(
      page.getByRole('button', { name: /unlock/i })
    ).not.toBeVisible();
  });
});
