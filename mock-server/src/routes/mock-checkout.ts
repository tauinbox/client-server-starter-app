import { Router } from 'express';
import type { Response } from 'express';
import { getState } from '../state';
import {
  activateSubscription,
  settlePurchase
} from '../helpers/billing-settle.helpers';
import type { MockCheckoutSession, MockPurchaseSession } from '../types';

// Stands in for the hosted checkout page of the provider. The server sends
// the buyer to the provider; the mock sends the buyer here, so a checkout can
// be completed by hand on the mock.
export const MOCK_CHECKOUT_PATH = '/api/__mock-checkout';

export function mockCheckoutUrl(sessionRef: string): string {
  return `${MOCK_CHECKOUT_PATH}/${sessionRef}`;
}

// The return URLs of the server (BillingUserService.checkoutUrl and
// settingsUrl), relative so that they resolve against the client origin.
const SUCCESS_URL = '/billing/success';
const CANCEL_URL = '/billing/cancel';
const SETTINGS_URL = '/billing/settings';

type OpenSession =
  | { kind: 'purchase'; session: MockPurchaseSession }
  | { kind: 'checkout'; session: MockCheckoutSession };

function findSession(sessionRef: string): OpenSession | undefined {
  const state = getState();
  const purchase = state.billingPurchaseSessions.get(sessionRef);
  if (purchase) return { kind: 'purchase', session: purchase };
  const checkout = state.billingCheckoutSessions.get(sessionRef);
  return checkout ? { kind: 'checkout', session: checkout } : undefined;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ] ?? char
  );
}

function formatAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(
    amountMinor / 100
  );
}

function describe(open: OpenSession): { title: string; amount: string } {
  const state = getState();
  if (open.kind === 'purchase') {
    const { session } = open;
    return {
      title: state.billingProducts.get(session.productId)?.name ?? 'Purchase',
      amount: formatAmount(session.amountMinor, session.currency)
    };
  }
  const { session } = open;
  if (session.kind === 'method') {
    return { title: 'Update the payment method', amount: '' };
  }
  const plan = [...state.plans.values()].find((p) => p.key === session.planKey);
  const price = plan?.prices[session.provider];
  return {
    title: `Plan: ${plan?.name ?? session.planKey}`,
    amount: price ? formatAmount(price.amountMinor ?? 0, price.currency) : ''
  };
}

function cancelUrl(open: OpenSession): string {
  return open.kind === 'checkout' && open.session.kind === 'method'
    ? SETTINGS_URL
    : CANCEL_URL;
}

function sessionNotFound(res: Response): void {
  res.status(404).type('text/plain').send('Checkout session not found');
}

function sendPage(res: Response, body: string, head = ''): void {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}<title>Mock checkout</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 24rem; margin: 3rem auto; padding: 0 1rem; }
.amount { font-size: 1.5rem; font-weight: 600; }
.actions { display: flex; gap: 1rem; align-items: center; margin-top: 1.5rem; }
</style>
</head>
<body>
<h1>Mock checkout</h1>
${body}
</body>
</html>`);
}

// Returns the buyer to the client through the document, not a 303. A
// relative Location resolves against the URL of the request, and a Playwright
// route sends that request to the port of the mock; a document-relative URL
// resolves against the page origin.
function sendReturn(res: Response, url: string): void {
  sendPage(
    res,
    `<p>Payment complete.</p>
<p><a href="${url}">Return to the store</a></p>`,
    `<meta http-equiv="refresh" content="0; url=${url}">
`
  );
}

const router = Router();

router.get('/:sessionRef', (req, res) => {
  const open = findSession(req.params.sessionRef);
  if (!open) {
    sessionNotFound(res);
    return;
  }
  const { title, amount } = describe(open);
  const ref = encodeURIComponent(open.session.sessionRef);
  sendPage(
    res,
    `<p>Provider: ${escapeHtml(open.session.provider)}</p>
<h2>${escapeHtml(title)}</h2>
${amount ? `<p class="amount">${escapeHtml(amount)}</p>` : ''}
<form class="actions" method="post" action="${MOCK_CHECKOUT_PATH}/${ref}/pay">
<button type="submit">Pay</button>
<a href="${cancelUrl(open)}">Cancel</a>
</form>`
  );
});

// Pay settles the session the way the paid webhook of the provider would,
// then returns the buyer to the client.
router.post('/:sessionRef/pay', (req, res) => {
  const open = findSession(req.params.sessionRef);
  if (!open) {
    sessionNotFound(res);
    return;
  }
  const state = getState();
  if (open.kind === 'purchase') {
    settlePurchase(open.session);
    sendReturn(res, SUCCESS_URL);
    return;
  }
  const { session } = open;
  state.billingCheckoutSessions.delete(session.sessionRef);
  if (session.kind === 'method') {
    // The mock swaps the method when the update starts.
    sendReturn(res, SETTINGS_URL);
    return;
  }
  const userId = state.billingCustomers.get(session.customerId)?.userId;
  const user = userId ? state.users.get(userId) : undefined;
  const plan = [...state.plans.values()].find((p) => p.key === session.planKey);
  if (!user || !plan) {
    sessionNotFound(res);
    return;
  }
  activateSubscription(user, plan, 'active', session.provider);
  sendReturn(res, SUCCESS_URL);
});

export default router;
