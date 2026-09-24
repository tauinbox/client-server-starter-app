import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import { createMockUser } from '../fixtures/mock-data';
import { mockId } from '../fixtures/ids';
import type { Page } from '@playwright/test';

const PASSWORD = 'Password1';
const TARGET_ID = mockId('user-3');
const TARGET_EMAIL = 'john@example.com';

const enrolledTarget = createMockUser({
  id: TARGET_ID,
  email: TARGET_EMAIL,
  firstName: 'John',
  lastName: 'Smith',
  password: PASSWORD,
  roles: ['user'],
  isActive: true,
  isEmailVerified: true,
  totpSecret: 'not-a-real-secret',
  totpEnabledAt: '2026-01-01T00:00:00.000Z',
  totpRecoveryCodes: ['spent-hash'],
  totpLastUsedStep: 1
});

async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: /John Doe/i }).click();
  await page.getByRole('menuitem', { name: /Logout/i }).click();
  await page.waitForURL(/\/login/);
}

test.describe('Two-factor reset by an administrator', () => {
  test('resets the factor of an enrolled user, who then signs in with the password alone', async ({
    _mockServer,
    page
  }) => {
    await _mockServer.seedUsers([enrolledTarget]);
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto(`/users/${TARGET_ID}/edit`);

    await expect(page.getByText('Two-factor on')).toBeVisible();
    await page.getByRole('button', { name: 'Reset two-factor' }).click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByText('Reset two-factor authentication')
    ).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Reset', exact: true });
    await expect(confirm).toBeDisabled();

    await dialog.getByLabel('Your current password').fill(PASSWORD);
    await confirm.click();

    await expect(
      page.getByText('Two-factor authentication was reset')
    ).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Two-factor on')).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Reset two-factor' })
    ).toBeHidden();

    await logout(page);
    await page.getByLabel('Email').fill(TARGET_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('main').getByRole('button', { name: 'Login' }).click();
    await page.waitForURL((url) => !url.pathname.endsWith('/login'));
    await expect(page.getByLabel('Authentication code')).toBeHidden();
  });

  test('keeps the factor when the administrator password is wrong', async ({
    _mockServer,
    page
  }) => {
    await _mockServer.seedUsers([enrolledTarget]);
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto(`/users/${TARGET_ID}/edit`);

    await page.getByRole('button', { name: 'Reset two-factor' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Your current password').fill('Wrong-Password-00');
    await dialog.getByRole('button', { name: 'Reset', exact: true }).click();

    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.reload();
    await expect(page.getByText('Two-factor on')).toBeVisible();
  });

  test('offers no reset for a user without the factor', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto(`/users/${TARGET_ID}/edit`);

    await expect(page.getByLabel('Email')).toHaveValue(TARGET_EMAIL);
    await expect(
      page.getByRole('button', { name: 'Reset two-factor' })
    ).toBeHidden();
  });
});
