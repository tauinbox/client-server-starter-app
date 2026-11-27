import { expect, test } from '../fixtures/base.fixture';
import { createMockUser } from '../fixtures/mock-data';
import { mockId } from '../fixtures/ids';
import { stubTurnstile } from '../fixtures/helpers';

test.describe('CAPTCHA soft-trigger', () => {
  test('forgot-password: shows widget after CAPTCHA_REQUIRED, succeeds with token', async ({
    _mockServer,
    page
  }) => {
    await stubTurnstile(page);
    await _mockServer.setCaptcha(true);

    await page.goto('/forgot-password');

    // First attempt: no captcha — backend returns CAPTCHA_REQUIRED because
    // forgot-password limit is 2 and the threshold is 1, so the very first
    // post-increment remaining is ≤ 1.
    await page.getByLabel('Email').fill('user@example.com');
    await page.getByRole('button', { name: /send link/i }).click();

    // Widget appears
    const fake = page.getByTestId('fake-turnstile');

    await expect(fake).toBeVisible();

    // Submit button stays disabled until the callback fires
    const submit = page.getByRole('button', { name: /send link/i });

    await expect(submit).toBeDisabled();

    await fake.click();
    await expect(submit).toBeEnabled();

    await submit.click();
    await expect(page.getByText(/check your email/i)).toBeVisible();
  });

  test('resend-verification: shows widget once the budget is spent', async ({
    _mockServer,
    page
  }) => {
    await stubTurnstile(page);
    await _mockServer.setCaptcha(true);
    await _mockServer.seedUsers([
      createMockUser({
        id: mockId('user-401'),
        email: 'resend-captcha@example.com',
        name: 'Resend Captcha',
        password: 'Password1',
        isActive: true,
        roles: ['user'],
        isEmailVerified: false
      })
    ]);

    const main = page.getByRole('main');
    const resend = page.getByRole('button', { name: /resend verification/i });

    async function reachResendButton(): Promise<void> {
      await page.goto('/login');
      await page.getByLabel('Email').fill('resend-captcha@example.com');
      await page.getByLabel('Email').blur();
      await page.getByLabel('Password', { exact: true }).fill('Password1');
      await page.getByLabel('Password', { exact: true }).blur();
      await main.getByRole('button', { name: 'Login' }).click();
      await expect(resend).toBeVisible();
    }

    // The route allows 3 calls a minute and the gate asks for a token once
    // the remaining count drops to 1, so the first resend is still free.
    await reachResendButton();
    await resend.click();
    await expect(page.getByText(/verification email sent/i)).toBeVisible();

    // The second resend reaches the threshold: the widget appears and the
    // button stays disabled until the callback fires.
    await reachResendButton();
    await resend.click();

    const fake = page.getByTestId('fake-turnstile');

    await expect(fake).toBeVisible();
    await expect(resend).toBeDisabled();
    await expect(
      page.getByText(/complete the CAPTCHA challenge/i)
    ).toBeVisible();
    await expect(page.getByText(/verification email sent/i)).toHaveCount(0);

    await fake.click();
    await expect(resend).toBeEnabled();

    await resend.click();
    await expect(page.getByText(/verification email sent/i)).toBeVisible();
  });

  test('does not render widget when captcha is disabled', async ({
    _mockServer,
    page
  }) => {
    await stubTurnstile(page);
    // Default state: captcha disabled.
    await page.goto('/forgot-password');

    await page.getByLabel('Email').fill('user@example.com');
    await page.getByRole('button', { name: /send link/i }).click();

    await expect(page.getByText(/check your email/i)).toBeVisible();
    await expect(page.getByTestId('fake-turnstile')).not.toBeVisible();
  });
});
