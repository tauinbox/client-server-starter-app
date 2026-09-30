import type { Page } from '@playwright/test';
import { test, expect, loginViaUi } from '../fixtures/base.fixture';

const USER_ID = '200';
const PADDLE_SCRIPT_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js';

type PaddleProbe = Window & {
  paddleProbe?: {
    environment: string | null;
    token: string | null;
    opened: string[];
    emit: (name: string) => void;
  };
};

// Serves a stand-in for the Paddle.js CDN script. It records what the app asks
// of Paddle.js and lets the test fire the checkout events of the overlay.
async function stubPaddleJs(page: Page): Promise<{ requests: string[] }> {
  const requests: string[] = [];
  await page.route(PADDLE_SCRIPT_URL, (route) => {
    requests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        const probe = { environment: null, token: null, opened: [], emit: () => {} };
        window.paddleProbe = probe;
        window.Paddle = {
          Environment: { set: (environment) => { probe.environment = environment; } },
          Initialize: (options) => {
            probe.token = options.token;
            probe.emit = (name) => options.eventCallback({ name });
          },
          Checkout: {
            open: (options) => { probe.opened.push(options.transactionId); },
            close: () => probe.emit('checkout.closed')
          }
        };
      `
    });
  });
  return { requests };
}

async function openedTransactions(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as PaddleProbe).paddleProbe?.opened ?? []);
}

async function emitPaddleEvent(page: Page, name: string): Promise<void> {
  await page.evaluate((event) => {
    (window as PaddleProbe).paddleProbe?.emit(event);
  }, name);
}

test.describe('Paddle checkout', () => {
  test('a subscription transaction opens the Paddle overlay, then confirms the plan', async ({
    page,
    _mockServer
  }) => {
    await _mockServer.setPaddleClientToken('test_e2e_token');
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await stubPaddleJs(page);

    await page.goto('/billing/success?_ptxn=txn_e2e01');

    await expect(
      page.getByRole('heading', { name: 'Opening the payment form…' })
    ).toBeVisible();
    await expect.poll(() => openedTransactions(page)).toEqual(['txn_e2e01']);
    expect(
      await page.evaluate(() => {
        const probe = (window as PaddleProbe).paddleProbe;
        return { environment: probe?.environment, token: probe?.token };
      })
    ).toEqual({ environment: 'sandbox', token: 'test_e2e_token' });

    // The provider webhook lands, and the buyer completes the payment.
    await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'pro'
    });
    await emitPaddleEvent(page, 'checkout.completed');

    await expect(
      page.getByRole('heading', { name: /You're on Pro/ })
    ).toBeVisible();
    await expect(page).toHaveURL(/\/billing\/success$/);
  });

  test('closing the Paddle overlay leads to the canceled page', async ({
    page,
    _mockServer
  }) => {
    await _mockServer.setPaddleClientToken('test_e2e_token');
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await stubPaddleJs(page);

    await page.goto('/billing/success?_ptxn=txn_e2e02');
    await expect.poll(() => openedTransactions(page)).toEqual(['txn_e2e02']);
    await emitPaddleEvent(page, 'checkout.closed');

    await expect(page).toHaveURL(/\/billing\/cancel$/);
    await expect(
      page.getByRole('heading', { name: 'Checkout canceled' })
    ).toBeVisible();
  });

  test('without a client token the page says the payment form is unavailable', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    const script = await stubPaddleJs(page);

    await page.goto('/billing/success?_ptxn=txn_e2e03');

    await expect(
      page.getByRole('heading', { name: 'Payment form unavailable' })
    ).toBeVisible();
    expect(script.requests).toEqual([]);
  });

  test('a payment-method change opens on the settings page and confirms the update', async ({
    page,
    _mockServer
  }) => {
    await _mockServer.setPaddleClientToken('test_e2e_token');
    await loginViaUi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'pro'
    });
    await stubPaddleJs(page);

    await page.goto('/billing/settings?_ptxn=txn_e2e04');
    await expect.poll(() => openedTransactions(page)).toEqual(['txn_e2e04']);
    await emitPaddleEvent(page, 'checkout.completed');

    await expect(page.getByText('Payment method updated.')).toBeVisible();
    await expect(page).toHaveURL(/\/billing\/settings$/);
    await expect(page.locator('.plan-summary')).toContainText('Pro');
  });
});
