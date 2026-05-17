import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base.fixture';

const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

// Stubs the global `turnstile` API. The real script is never loaded; instead
// the route below returns a tiny shim that mounts a button into the host
// container. Pressing the button fires the Turnstile callback with a
// deterministic token that the mock-server accepts.
async function stubTurnstile(page: Page) {
  await page.route(`${TURNSTILE_SCRIPT_URL}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.turnstile = {
          render: function (container, options) {
            const el = typeof container === 'string'
              ? document.querySelector(container)
              : container;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.testid = 'fake-turnstile';
            btn.textContent = 'Solve CAPTCHA';
            btn.addEventListener('click', function () {
              if (options && typeof options.callback === 'function') {
                options.callback('test-token');
              }
            });
            el.appendChild(btn);
            return 'widget-1';
          },
          reset: function () {},
          remove: function () {},
          getResponse: function () { return undefined; }
        };
      `
    })
  );
}

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
