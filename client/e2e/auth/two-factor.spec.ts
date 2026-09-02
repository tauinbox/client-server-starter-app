import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import {
  MOCK_RECOVERY_CODES,
  MOCK_TOTP_CODE
} from '../../../mock-server/src/constants';
import type { Page } from '@playwright/test';

const EMAIL = 'testlogin@example.com';
const PASSWORD = 'Password1';

async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: /John Doe/i }).click();
  await page.getByRole('menuitem', { name: /Logout/i }).click();
  await page.waitForURL(/\/login/);
}

/**
 * The mock accepts one fixed code on purpose: a real time-based code would tie
 * every run of this file to the clock.
 */
test.describe('two-factor authentication', () => {
  test('is enrolled from the profile page and then guards the sign-in', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    const card = page.locator('nxs-two-factor');
    await expect(card).toBeVisible();
    await expect(
      card.getByText('Two-factor authentication is off')
    ).toBeVisible();

    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.locator('.two-factor-qr')).toBeVisible();
    await expect(page.getByText('Cannot scan?')).toBeVisible();

    await page.getByLabel('Authentication code').fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Turn on' }).click();

    // The recovery codes are shown exactly once, here.
    await expect(page.getByText(MOCK_RECOVERY_CODES[0])).toBeVisible();
    await page.getByRole('button', { name: 'I saved them' }).click();
    await expect(
      card.getByText('Two-factor authentication is on')
    ).toBeVisible();

    await logout(page);

    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('main').getByRole('button', { name: 'Login' }).click();

    // The password alone does not sign in any more.
    await expect(page).toHaveURL(/\/login/);
    const codeField = page.getByLabel('Authentication code');
    await expect(codeField).toBeVisible();

    await codeField.fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await codeField.fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  });

  test('lets a recovery code in once and refuses it afterwards', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Authentication code').fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByRole('button', { name: 'I saved them' }).click();
    await logout(page);

    async function signInWithRecoveryCode(): Promise<void> {
      await page.getByLabel('Email').fill(EMAIL);
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page
        .getByRole('main')
        .getByRole('button', { name: 'Login' })
        .click();
      await page.getByRole('button', { name: 'Use a recovery code' }).click();
      await page.getByLabel('Recovery code').fill(MOCK_RECOVERY_CODES[0]);
      await page.getByRole('button', { name: 'Verify' }).click();
    }

    await signInWithRecoveryCode();
    await page.waitForURL((url) => !url.pathname.endsWith('/login'));

    await logout(page);

    await signInWithRecoveryCode();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('renders the enrolment panel without overflow at every width', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('.two-factor-qr')).toBeVisible();
    await page.getByLabel('Authentication code').fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByText(MOCK_RECOVERY_CODES[0])).toBeVisible();

    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      for (const width of [375, 768, 1366]) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        );
        expect(
          overflow,
          `horizontal overflow at ${width}px in ${colorScheme}`
        ).toBeLessThanOrEqual(0);
      }
    }
  });
});
