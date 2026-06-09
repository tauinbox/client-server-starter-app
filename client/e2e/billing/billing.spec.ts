import type { Page } from '@playwright/test';
import { test, expect, loginViaUi } from '../fixtures/base.fixture';

const USER_ID = '200';

// The client redirects to the provider's hosted checkout via window.location.
// That host is unreachable in tests, so intercept the navigation and fulfill it
// with a blank page; the test then simulates the provider webhook via /__control.
async function stubHostedCheckout(page: Page) {
  await page.route('**/mock-checkout.local/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>checkout</body></html>'
    })
  );
}

test.describe('Billing', () => {
  test('anonymous visitor sees pricing without the region control', async ({
    page,
    _mockServer
  }) => {
    await page.goto('/billing');

    await expect(
      page.getByRole('heading', { name: 'Plans', level: 1 })
    ).toBeVisible();
    await expect(page.locator('nxs-plan-card')).toHaveCount(3);
    await expect(page.locator('.region-control')).toHaveCount(0);
  });

  test('anonymous "Choose" routes to login with a billing return url', async ({
    page,
    _mockServer
  }) => {
    await page.goto('/billing');
    await page
      .locator('nxs-plan-card', { hasText: 'Pro' })
      .getByRole('button', { name: 'Choose' })
      .click();

    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fbilling/);
  });

  test('authenticated pricing shows the region control', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await page.goto('/billing');

    await expect(page.locator('.region-control')).toBeVisible();
    await expect(
      page.locator('.region-control').getByRole('radio', { name: 'Auto' })
    ).toBeVisible();
  });

  test('checkout → active subscription → cancel', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await stubHostedCheckout(page);

    // Start checkout for Pro from the pricing page.
    await page.goto('/billing');
    await page
      .locator('nxs-plan-card', { hasText: 'Pro' })
      .getByRole('button', { name: 'Choose' })
      .click();

    // The browser is redirected to the (stubbed) hosted checkout.
    await expect(page).toHaveURL(/mock-checkout\.local/);

    // Simulate the provider webhook activating the subscription, then return.
    await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'pro'
    });

    await page.goto('/billing/success');
    await expect(
      page.getByRole('heading', { name: /You're on Pro/ })
    ).toBeVisible();

    // Settings reflects the active plan + a paid invoice.
    await page.goto('/billing/settings');
    await expect(page.locator('.plan-summary')).toContainText('Pro');
    await expect(page.locator('.plan-summary')).toContainText('Active');
    await expect(page.locator('.invoice-table tbody tr')).toHaveCount(1);

    // Cancel at period end via the confirm dialog.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel subscription' }).click();

    await expect(page.locator('.plan-summary')).toContainText('Cancels on');
  });
});
