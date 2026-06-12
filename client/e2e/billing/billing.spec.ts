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

  test('one-time SKU purchase settles into a paid invoice and a thank-you return', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await stubHostedCheckout(page);

    // The one-time section renders the seeded catalog below the plans.
    await page.goto('/billing');
    const skuCard = page.locator('nxs-product-card', {
      hasText: 'Report pack'
    });
    await expect(skuCard).toBeVisible();
    await expect(skuCard).toContainText('$5.00');

    await skuCard.getByRole('button', { name: 'Buy' }).click();
    await expect(page).toHaveURL(/mock-checkout\.local/);

    // Simulate the provider's paid webhook, then return from checkout.
    await _mockServer.completeBillingPurchase({ userId: USER_ID });
    await page.goto('/billing/success');

    await expect(
      page.getByRole('heading', { name: 'Thank you for your purchase!' })
    ).toBeVisible();
    await expect(page.locator('.purchase-summary')).toContainText(
      'Report pack'
    );
    await expect(page.locator('.purchase-summary')).toContainText('$5.00');

    // The paid one-time invoice is in the history; no subscription appeared.
    await page.goto('/billing/settings');
    await expect(page.locator('.invoice-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.invoice-table')).toContainText('$5.00');
    await expect(page.locator('.plan-summary')).toContainText(
      'No subscription yet'
    );
  });

  test('donation with a custom amount and note settles at the chosen amount', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await stubHostedCheckout(page);

    await page.goto('/billing');
    const donationCard = page.locator('nxs-donation-card');
    await expect(donationCard).toBeVisible();

    // Quick presets derive from the catalog minimum ($1): $3 / $5 / Custom.
    await expect(
      donationCard.getByRole('button', { name: 'Pay $3.00' })
    ).toBeEnabled();

    await donationCard.getByRole('radio', { name: 'Custom' }).click();
    await donationCard.getByRole('textbox', { name: 'Amount' }).fill('15');
    await donationCard
      .getByRole('textbox', { name: 'Note (optional)' })
      .fill('Keep it up');
    await donationCard.getByRole('button', { name: 'Pay $15.00' }).click();

    await expect(page).toHaveURL(/mock-checkout\.local/);

    await _mockServer.completeBillingPurchase({ userId: USER_ID });
    await page.goto('/billing/success');

    await expect(
      page.getByRole('heading', { name: 'Thank you for your purchase!' })
    ).toBeVisible();
    await expect(page.locator('.purchase-summary')).toContainText('$15.00');

    await page.goto('/billing/settings');
    await expect(page.locator('.invoice-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.invoice-table')).toContainText('$15.00');
  });

  test('donation rejects an out-of-bounds custom amount client-side', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });

    await page.goto('/billing');
    const donationCard = page.locator('nxs-donation-card');
    await donationCard.getByRole('radio', { name: 'Custom' }).click();

    // $0.50 is below the $1 catalog minimum: error shown, pay disabled.
    const amount = donationCard.getByRole('textbox', { name: 'Amount' });
    await amount.fill('0.50');
    await amount.blur();
    await expect(donationCard.locator('mat-error')).toContainText(
      'between $1.00 and $500.00'
    );
    await expect(
      donationCard.getByRole('button', { name: /^Pay/ })
    ).toBeDisabled();
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

  test('buying a credit pack raises the wallet balance in settings', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await stubHostedCheckout(page);

    // Before any purchase the wallet shows the confident zero state.
    await page.goto('/billing/settings');
    const credits = page.locator('.credits-card');
    await expect(credits.locator('.credits-units')).toHaveText('0');
    await expect(credits.locator('.credits-hint')).toBeVisible();
    await expect(credits.getByRole('link', { name: 'Top up' })).toBeVisible();

    // The top-up action lands on the pricing page's credit packs.
    await credits.getByRole('link', { name: 'Top up' }).click();
    await expect(page).toHaveURL(/\/billing$/);
    const pack = page.locator('nxs-product-card', {
      hasText: '1000 credits'
    });
    await expect(pack).toContainText('$9.00');
    await pack.getByRole('button', { name: 'Buy' }).click();
    await expect(page).toHaveURL(/mock-checkout\.local/);

    // Settle the provider's paid webhook; the wallet reflects the pack.
    await _mockServer.completeBillingPurchase({ userId: USER_ID });
    await page.goto('/billing/settings');
    await expect(credits.locator('.credits-units')).toHaveText('1,000');
    await expect(credits.locator('.credits-hint')).toHaveCount(0);
    await expect(
      credits.getByRole('link', { name: 'Buy credits' })
    ).toBeVisible();
  });

  test('metered usage consumes prepaid credits at the period close', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await stubHostedCheckout(page);

    // Pay-as-you-go subscription + a 1000-unit pack in the wallet.
    const subscription = await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'usage'
    });
    await page.goto('/billing');
    await page
      .locator('nxs-product-card', { hasText: '1000 credits' })
      .getByRole('button', { name: 'Buy' })
      .click();
    await expect(page).toHaveURL(/mock-checkout\.local/);
    await _mockServer.completeBillingPurchase({ userId: USER_ID });

    // 142 metered units close the period: credits cover them one-for-one,
    // so the postpaid invoice is zero and the wallet drops to 858.
    await _mockServer.seedBillingUsage({
      customerId: subscription.customerId,
      quantity: 142
    });
    await _mockServer.advanceBillingRenewal({ userId: USER_ID });

    await page.goto('/billing/settings');
    await expect(page.locator('.credits-card .credits-units')).toHaveText(
      '858'
    );
    // Three invoices: $0 activation, the $9.00 pack, and the $0 postpaid
    // close — without credits the 142 units would have charged $2.84.
    await expect(page.locator('.invoice-table tbody tr')).toHaveCount(3);
    await expect(
      page.locator('.invoice-table tbody tr', { hasText: '$9.00' })
    ).toHaveCount(1);
    await expect(
      page.locator('.invoice-table tbody tr', { hasText: '$2.84' })
    ).toHaveCount(0);
  });
});
