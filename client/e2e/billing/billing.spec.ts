import type { Page } from '@playwright/test';
import { test, expect, loginViaUi } from '../fixtures/base.fixture';

const USER_ID = '200';
const MOCK_CHECKOUT_URL = /\/api\/__mock-checkout\//;

// The mock sends the browser to its own hosted-checkout page; Pay settles the
// session the way the provider webhook would and returns to the client.
async function payOnMockCheckout(page: Page) {
  await expect(page).toHaveURL(MOCK_CHECKOUT_URL);
  await page.getByRole('button', { name: 'Pay' }).click();
}

type SnackbarCounter = Window & { snackbarsOpened?: number };

// A second snackbar replaces the first one, so the number on screen cannot tell
// one message from two. This counts each snackbar that the next page opens.
// The overlay moves its host in the DOM, so the count is of distinct elements.
async function countOpenedSnackbars(page: Page) {
  await page.addInitScript(() => {
    const counter = window as SnackbarCounter;
    const opened = new Set<Element>();
    counter.snackbarsOpened = 0;
    new MutationObserver(() => {
      for (const container of document.querySelectorAll(
        'mat-snack-bar-container'
      )) {
        opened.add(container);
      }
      counter.snackbarsOpened = opened.size;
    }).observe(document, { childList: true, subtree: true });
  });
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
    await expect(
      page.getByRole('link', { name: 'Manage billing' })
    ).toHaveCount(0);
  });

  test('a signed-in user reaches billing settings from the pricing page', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await page.goto('/billing');

    await page.getByRole('link', { name: 'Manage billing' }).click();

    await expect(page).toHaveURL(/\/billing\/settings$/);
    await expect(
      page.getByRole('heading', { name: 'Billing', level: 1 })
    ).toBeVisible();
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

  test('with every provider off, the plans cannot be chosen and a notice says why', async ({
    page,
    _mockServer
  }) => {
    await _mockServer.setBillingProviderEnabled('paddle', false);
    await _mockServer.setBillingProviderEnabled('yookassa', false);
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await page.goto('/billing');

    const notice = page.locator('.payments-unavailable');
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(notice).toContainText(
      'Payments are temporarily unavailable in your billing region.'
    );
    await expect(
      page
        .locator('nxs-plan-card', { hasText: 'Pro' })
        .getByRole('button', { name: 'Choose' })
    ).toBeDisabled();
  });

  test('leaving a region whose provider is off enables the plans again', async ({
    page,
    _mockServer
  }) => {
    await _mockServer.setBillingProviderEnabled('paddle', false);
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await page.goto('/billing');

    const choosePro = page
      .locator('nxs-plan-card', { hasText: 'Pro' })
      .getByRole('button', { name: 'Choose' });
    const notice = page.locator('.payments-unavailable');
    await expect(notice).toBeVisible();
    await expect(choosePro).toBeDisabled();

    const saved = page.waitForResponse(
      (response) =>
        response.url().includes('/billing/region') &&
        response.request().method() === 'PUT'
    );
    await page
      .locator('.region-control')
      .getByRole('radio', { name: 'Russia' })
      .click();
    expect((await saved).status()).toBe(200);

    await expect(notice).toHaveCount(0);
    await expect(choosePro).toBeEnabled();
  });

  test('a refused region change leaves the toggle on the stored region', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'pro'
    });
    await page.goto('/billing');

    const region = page.locator('.region-control');
    const refused = page.waitForResponse(
      (response) =>
        response.url().includes('/billing/region') &&
        response.request().method() !== 'GET'
    );
    await region.getByRole('radio', { name: 'Russia' }).click();
    expect((await refused).status()).toBe(409);

    await expect(region.getByRole('radio', { name: 'Auto' })).toBeChecked();
    await expect(
      region.getByRole('radio', { name: 'Russia' })
    ).not.toBeChecked();
  });

  test('a refused region change shows its reason on the Russian interface', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'pro'
    });
    await page.evaluate(() =>
      window.localStorage.setItem('preferred-language', 'ru')
    );
    await countOpenedSnackbars(page);
    await page.goto('/billing');

    const region = page.locator('.region-control');
    const refused = page.waitForResponse(
      (response) =>
        response.url().includes('/billing/region') &&
        response.request().method() !== 'GET'
    );
    await region.getByRole('radio', { name: 'Россия' }).click();
    expect((await refused).status()).toBe(409);

    const snackbar = page.locator('mat-snack-bar-container');
    await expect(snackbar).toContainText(
      'Чтобы сменить регион оплаты, сначала отмените текущую подписку.'
    );
    await expect(snackbar).not.toContainText(
      'Не удалось изменить регион оплаты.'
    );
    expect(
      await page.evaluate(() => (window as SnackbarCounter).snackbarsOpened)
    ).toBe(1);
  });

  test('plan and product cards are translated on the Russian interface', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await page.evaluate(() =>
      window.localStorage.setItem('preferred-language', 'ru')
    );
    await page.goto('/billing');

    await expect(
      page.locator('nxs-plan-card', { hasText: 'Бесплатный' })
    ).toContainText('Базовый доступ без оплаты');
    await expect(
      page.locator('nxs-product-card', { hasText: 'Пакет отчётов' })
    ).toContainText('30 дней доступа к отчётам без подписки');
    await expect(
      page.locator('nxs-donation-card', { hasText: 'Пожертвование' })
    ).toContainText('Поддержите проект любой суммой');
    await expect(page.locator('main')).not.toContainText('Core access');
  });

  test('the renewal date is formatted in Russian on the Russian interface', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'pro'
    });
    await page.evaluate(() =>
      window.localStorage.setItem('preferred-language', 'ru')
    );
    await page.goto('/billing/settings');

    await expect(page.locator('.renewal')).toHaveText(
      /^\s*Продление \d{1,2} [а-я]+\.? \d{4} г\.\s*$/
    );
  });

  test('a region whose provider was turned off after the page loaded is refused with the reason', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await page.goto('/billing');

    const region = page.locator('.region-control');
    await expect(region.getByRole('radio', { name: 'Russia' })).toBeVisible();
    await _mockServer.setBillingProviderEnabled('yookassa', false);
    const refused = page.waitForResponse(
      (response) =>
        response.url().includes('/billing/region') &&
        response.request().method() !== 'GET'
    );
    await region.getByRole('radio', { name: 'Russia' }).click();
    expect((await refused).status()).toBe(409);

    await expect(page.locator('mat-snack-bar-container')).toContainText(
      'Payments are not available in this billing region.'
    );
    await expect(region.getByRole('radio', { name: 'Auto' })).toBeChecked();
  });

  test('the region control hides with one provider, but shows to leave a provider that was turned off', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await page.goto('/billing/settings');

    const region = page.locator('.settings-header .region-control');
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes('/billing/region') &&
        response.request().method() === 'PUT'
    );
    await region.getByRole('radio', { name: 'Russia' }).click();
    expect((await saved).status()).toBe(200);

    await _mockServer.setBillingProviderEnabled('yookassa', false);
    await page.reload();
    await expect(region.getByRole('radio', { name: 'Russia' })).toBeChecked();

    const left = page.waitForResponse(
      (response) =>
        response.url().includes('/billing/region') &&
        response.request().method() === 'PUT'
    );
    await region.getByRole('radio', { name: 'International' }).click();
    expect((await left).status()).toBe(200);
    await expect(region).toHaveCount(0);

    // Plans and region load together, so a rendered card means the region is known.
    await page.goto('/billing');
    await expect(page.locator('nxs-plan-card').first()).toBeVisible();
    await expect(page.locator('.region-control')).toHaveCount(0);
  });

  test('checkout → active subscription → cancel', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });

    // Start checkout for Pro from the pricing page.
    await page.goto('/billing');
    await page
      .locator('nxs-plan-card', { hasText: 'Pro' })
      .getByRole('button', { name: 'Choose' })
      .click();

    await payOnMockCheckout(page);

    await expect(page).toHaveURL(/\/billing\/success$/);
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

  test('a subscriber is sent from the pricing page to the plan change in settings', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'pro'
    });
    let checkouts = 0;
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().endsWith('/billing/checkout')
      ) {
        checkouts++;
      }
    });

    await page.goto('/billing');
    for (const plan of ['Free', 'Business']) {
      await expect(
        page
          .locator('nxs-plan-card', { hasText: plan })
          .getByRole('button', { name: 'Change plan' })
      ).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Choose' })).toHaveCount(0);

    await page
      .locator('nxs-plan-card', { hasText: 'Business' })
      .getByRole('button', { name: 'Change plan' })
      .click();

    await expect(page).toHaveURL(/\/billing\/settings$/);
    await expect(page.locator('.plan-summary')).toContainText('Pro');
    expect(checkouts).toBe(0);
  });

  test('an unpaid incomplete checkout keeps "Choose" on the pricing page', async ({
    page,
    _mockServer
  }) => {
    // The ru profile locale routes the user to YooKassa, whose checkout leaves
    // an `incomplete` subscription until the payment settles.
    await loginViaUi(page, _mockServer.url, {
      id: USER_ID,
      roles: ['user'],
      locale: 'ru'
    });

    await page.goto('/billing');
    await page
      .locator('nxs-plan-card', { hasText: 'Pro' })
      .getByRole('button', { name: 'Choose' })
      .click();
    await expect(page).toHaveURL(MOCK_CHECKOUT_URL);
    await page.getByRole('link', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/\/billing\/cancel$/);

    await page.goto('/billing');
    const pro = page.locator('nxs-plan-card', { hasText: 'Pro' });
    await expect(pro.getByRole('button', { name: 'Choose' })).toBeVisible();
    await expect(
      page
        .locator('nxs-plan-card', { hasText: 'Free' })
        .locator('.current-badge')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change plan' })).toHaveCount(
      0
    );
  });

  test('a Paddle plan change via the proration dialog adds no local receipt', async ({
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

    // Paddle prorates on its side, so the history keeps the period invoice only.
    await expect(page.locator('.invoice-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.invoice-table')).not.toContainText('Refunded');
  });

  test('a YooKassa plan change via the proration dialog surfaces the receipts', async ({
    page,
    _mockServer
  }) => {
    // The ru profile locale routes the user to YooKassa; the UI stays English.
    await loginViaUi(page, _mockServer.url, {
      id: USER_ID,
      roles: ['user'],
      locale: 'ru'
    });
    await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'pro'
    });

    await page.goto('/billing/settings');
    await page.getByRole('button', { name: 'Change plan' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: /Business/ }).click();
    await expect(dialog.locator('.due-now dd')).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.locator('.plan-summary')).toContainText('Business');

    // The period invoice plus the two legs of the switch (charge + refund).
    await expect(page.locator('.invoice-table tbody tr')).toHaveCount(3);
    await expect(page.locator('.invoice-table')).toContainText('Refunded');
  });

  test('payment-method update redirects to the provider and swaps the card', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'pro'
    });

    await page.goto('/billing/settings');
    await expect(page.locator('.payment-method')).toContainText('4242');

    await page.getByRole('button', { name: 'Update' }).click();
    await payOnMockCheckout(page);

    // The mock swaps the default method when the update starts, so the new
    // card is visible as soon as the user returns.
    await expect(page).toHaveURL(/\/billing\/settings$/);
    await expect(page.locator('.payment-method')).toContainText('mastercard');
    await expect(page.locator('.payment-method')).toContainText('4444');
  });

  test('one-time SKU purchase settles into a paid invoice and a thank-you return', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });

    // The one-time section renders the seeded catalog below the plans.
    await page.goto('/billing');
    const skuCard = page.locator('nxs-product-card', {
      hasText: 'Report pack'
    });
    await expect(skuCard).toBeVisible();
    await expect(skuCard).toContainText('$5.00');

    await skuCard.getByRole('button', { name: 'Buy' }).click();
    await payOnMockCheckout(page);
    await expect(page).toHaveURL(/\/billing\/success$/);

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

    await payOnMockCheckout(page);
    await expect(page).toHaveURL(/\/billing\/success$/);

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
    await payOnMockCheckout(page);
    await expect(page).toHaveURL(/\/billing\/success$/);

    // The wallet reflects the pack.
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
    await payOnMockCheckout(page);
    await expect(page).toHaveURL(/\/billing\/success$/);

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
