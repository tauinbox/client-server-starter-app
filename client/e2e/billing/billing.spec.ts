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

    // Settings reflects the active plan + a paid invoice. Fixed-mode plans
    // have no metered usage, so the usage meter must not render.
    await page.goto('/billing/settings');
    await expect(page.locator('.plan-summary')).toContainText('Pro');
    await expect(page.locator('.plan-summary')).toContainText('Active');
    await expect(page.locator('.invoice-table tbody tr')).toHaveCount(1);
    await expect(page.locator('nxs-usage-meter')).toHaveCount(0);

    // Cancel at period end via the confirm dialog.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel subscription' }).click();

    await expect(page.locator('.plan-summary')).toContainText('Cancels on');
  });

  test('change plan via the proration dialog surfaces the receipts', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'pro'
    });

    await page.goto('/billing/settings');
    await page.getByRole('button', { name: 'Change plan' }).click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Change plan' })
    ).toBeVisible();

    // Selecting a target fetches the proration preview. The en-locale user is
    // on Paddle (delegated lifecycle), so the ledger shows the net amount:
    // business $29.00 minus the unused pro $12.00 with a full period left.
    await dialog.getByRole('radio', { name: /Business/ }).click();
    await expect(dialog.locator('.due-now dd')).toHaveText('$17.00');

    await dialog.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.locator('.plan-summary')).toContainText('Business');

    // Proration receipts surfaced in the invoice history: the original period
    // invoice plus the two legs of the switch (charge + refund).
    await expect(page.locator('.invoice-table tbody tr')).toHaveCount(3);
    await expect(page.locator('.invoice-table')).toContainText('Refunded');
  });

  test('payment-method update redirects to the provider and swaps the card', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await stubHostedCheckout(page);
    await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'pro'
    });

    await page.goto('/billing/settings');
    await expect(page.locator('.payment-method')).toContainText('4242');

    await page.getByRole('button', { name: 'Update' }).click();
    await expect(page).toHaveURL(/mock-checkout\.local/);

    // The mock settles the provider's success webhook synchronously, so the
    // swapped default method is visible as soon as the user returns.
    await page.goto('/billing/settings');
    await expect(page.locator('.payment-method')).toContainText('mastercard');
    await expect(page.locator('.payment-method')).toContainText('4444');
  });

  test('usage subscription shows the current-period usage meter', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });

    // Put the user on the pay-as-you-go plan and meter some usage. The seeded
    // usage plan is paddle/USD with unitPriceMinor 2 and no included units,
    // so 142 units accrue 284 minor units = $2.84.
    const subscription = await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'usage'
    });
    await _mockServer.seedBillingUsage({
      customerId: subscription.customerId,
      quantity: 142
    });

    await page.goto('/billing/settings');

    const meter = page.locator('nxs-usage-meter');
    await expect(meter).toBeVisible();
    await expect(meter.locator('.usage-readout .total')).toHaveText('142');
    await expect(meter.locator('.meter-key')).toHaveText('api_calls');
    await expect(meter.locator('.ledger-row.accrued')).toContainText('$2.84');
    // Pure pay-as-you-go (no included units) renders no quota gauge.
    await expect(meter.locator('.usage-gauge')).toHaveCount(0);
  });

  test('usage meter shows the empty state with no metered usage', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'usage'
    });

    await page.goto('/billing/settings');

    const meter = page.locator('nxs-usage-meter');
    await expect(meter).toBeVisible();
    await expect(meter.locator('.usage-empty')).toBeVisible();
  });
});
