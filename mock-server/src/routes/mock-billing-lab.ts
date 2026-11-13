import { Router } from 'express';
import type { Request, Response } from 'express';
import { BILLING_PROVIDER_FLAGS, FREE_PLAN_KEY } from '@app/shared/constants';
import type { BillingProviderId } from '@app/shared/types';
import { randomUUID } from 'crypto';
import { geoDefault } from '@app/shared/utils/billing-rules';
import { getState, resetState } from '../state';
import type { MockSubscription, MockUser } from '../types';
import {
  advanceRenewal,
  findRenewableSubscription,
  setProviderEnabled
} from '../helpers/billing-clock.helpers';
import {
  consumeCredits,
  unitsSpentThisMonth
} from '../helpers/billing-metering.helpers';
import {
  applyCreditDelta,
  crossesZero,
  notifyEntitlementsChanged
} from '../helpers/billing-settle.helpers';
import {
  applyBillingPreset,
  BILLING_PRESETS,
  isBillingPreset,
  type BillingPreset
} from '../helpers/billing-presets.helpers';
import { escapeHtml, formatAmount } from '../utils/html';

// A page for the manual check of every billing mode on the mock: put a user in
// a billing state, use units from the credits, run the renewal clock, and toggle the
// catalog and the providers. It is under /api so that the dev proxy of the
// client serves it on the client origin. It exists in the mock only.
export const MOCK_BILLING_LAB_PATH = '/api/__mock-billing';

const PRESET_LABELS: Record<BillingPreset, string> = {
  free: 'Free (no subscription)',
  pro: 'Pro, active',
  business: 'Business, active',
  'payg-empty': 'Pay as you go, balance 0',
  'payg-funded': 'Pay as you go, balance 500',
  trialing: 'Pro, trial (14 days)',
  'past-due': 'Pro, past due (one failed charge)',
  canceling: 'Pro, cancel at period end'
};

const PROVIDERS: BillingProviderId[] = BILLING_PROVIDER_FLAGS.map(
  ({ provider }) => provider
);

function isProvider(value: unknown): value is BillingProviderId {
  return PROVIDERS.includes(value as BillingProviderId);
}

type Body = Record<string, unknown>;

function body(req: Request): Body {
  return req.body as Body;
}

function asPositiveInt(value: unknown): number | null {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function refuse(res: Response, message: string): void {
  // eslint-disable-next-line no-restricted-syntax -- a mock-only page with no server route; its own script shows the text
  res.status(400).json({ message });
}

function findUser(value: unknown): MockUser | undefined {
  return typeof value === 'string' ? getState().users.get(value) : undefined;
}

function customerOf(user: MockUser) {
  return getState()
    .billingCustomers.values()
    .find((c) => c.userId === user.id);
}

/** The open subscription of the user, a canceled one only when none is open. */
function latestSubscription(user: MockUser): MockSubscription | undefined {
  const customer = customerOf(user);

  if (!customer) return undefined;

  const rows = [...getState().billingSubscriptions.values()]
    .filter((s) => s.customerId === customer.id)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));

  return rows.find((s) => s.status !== 'canceled') ?? rows[0];
}

const router = Router();

router.post('/preset', (req, res) => {
  const { userId, preset, provider } = body(req);
  const user = findUser(userId);

  if (!user || !isBillingPreset(preset)) {
    refuse(res, 'Pick a user and a preset.');

    return;
  }

  applyBillingPreset(user, {
    preset,
    provider: isProvider(provider) ? provider : null
  });
  res.json({ message: `${user.email}: ${PRESET_LABELS[preset]}` });
});

router.post('/usage', (req, res) => {
  const { userId, quantity } = body(req);
  const user = findUser(userId);
  const units = asPositiveInt(quantity);
  const customer = user ? customerOf(user) : undefined;

  if (!customer || units === null) {
    refuse(res, 'The user needs a billing customer (pick a preset first).');

    return;
  }

  const outcome = consumeCredits(customer.id, {
    meterKey: 'api_calls',
    units,
    idempotencyKey: `lab-${randomUUID()}`,
    occurredAt: new Date().toISOString()
  });

  if ('refusal' in outcome) {
    refuse(res, outcome.refusal.message);

    return;
  }

  res.json({
    message: outcome.response.debited
      ? `Used ${units} units; ${outcome.response.balanceAfter} credits left`
      : `Used ${units} units; the plan includes the meter, so no credits were taken`
  });
});

router.post('/renewal', (req, res) => {
  const { userId, outcome } = body(req);
  const user = findUser(userId);
  const subscription = user
    ? findRenewableSubscription({ userId: user.id })
    : undefined;

  if (!subscription || (outcome !== 'success' && outcome !== 'failure')) {
    refuse(res, 'The user needs an entitled subscription.');

    return;
  }

  const advanced = advanceRenewal(subscription, outcome);

  if (!advanced) {
    refuse(res, 'The plan of the subscription has no price.');

    return;
  }

  res.json({
    message: `Renewal ${outcome}: the subscription is ${advanced.status}`
  });
});

router.post('/credits', (req, res) => {
  const { userId, units } = body(req);
  const user = findUser(userId);
  const amount = asPositiveInt(units);
  const customer = user ? customerOf(user) : undefined;

  if (!customer || amount === null) {
    refuse(res, 'The user needs a billing customer (pick a preset first).');

    return;
  }

  // A paid pack tells the owner through its invoice; the lab has none.
  if (crossesZero(applyCreditDelta(customer.id, amount))) {
    notifyEntitlementsChanged(customer.id);
  }

  res.json({ message: `Added ${amount} credits` });
});

router.post('/trial', (req, res) => {
  const { planKey, days } = body(req);
  const plan = getState()
    .plans.values()
    .find((p) => p.key === planKey && p.key !== FREE_PLAN_KEY);
  const trialDays = Number(days);

  if (!plan || !Number.isInteger(trialDays) || trialDays < 0) {
    refuse(res, 'Pick a plan and a number of days (0 turns the trial off).');

    return;
  }

  plan.trialDays = trialDays;
  res.json({ message: `${plan.name}: ${trialDays} trial days` });
});

router.post('/provider', (req, res) => {
  const { provider, enabled } = body(req);
  const on = enabled === 'true';

  if (!isProvider(provider) || !setProviderEnabled(provider, on)) {
    refuse(res, 'Unknown provider.');

    return;
  }

  res.json({ message: `${provider} ${on ? 'enabled' : 'disabled'}` });
});

router.post('/reset', (_req, res) => {
  resetState();
  res.json({ message: 'The mock state is back to the seed data' });
});

router.get('/', (req, res) => {
  const { userId, done } = req.query;
  const state = getState();
  const users = [...state.users.values()].filter((u) => !u.deletedAt);
  const user = findUser(userId) ?? users[0];

  res.type('html').send(renderPage({ user, users, done }));
});

function option(value: string, label: string, selected = false): string {
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function row(label: string, value: string): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

function renderState(user: MockUser): string {
  const state = getState();
  const customer = customerOf(user);
  const subscription = latestSubscription(user);

  if (!customer) {
    return '<p>No billing customer yet: the user is on Free.</p>';
  }

  const rows = [
    row(
      'Billing region',
      `${customer.providerOverride ?? geoDefault(customer.country)} (country ${customer.country}${customer.providerOverride ? ', override' : ''})`
    ),
    row(
      'Credits',
      String(state.billingCreditBalances.get(customer.id)?.balanceUnits ?? 0)
    ),
    row(
      'Units spent this month',
      String(unitsSpentThisMonth(customer.id).unitsSpent)
    )
  ];

  if (subscription) {
    const plan = state.plans
      .values()
      .find((p) => p.key === subscription.planKey);

    rows.push(
      row(
        'Plan',
        `${plan?.name ?? subscription.planKey} (${subscription.billingMode})`
      ),
      row('Status', subscription.status),
      row(
        'Provider',
        `${subscription.provider} (${subscription.lifecycleOwner}-managed)`
      ),
      row(
        'Period',
        `${subscription.currentPeriodStart} - ${subscription.currentPeriodEnd}`
      ),
      row('Cancel at period end', String(subscription.cancelAtPeriodEnd)),
      row('Trial end', subscription.trialEnd ?? '-'),
      row('Failed charges', String(subscription.dunningAttempts ?? 0))
    );
  } else {
    rows.push(row('Subscription', 'none: the user is on Free'));
  }

  const invoices = [...state.billingInvoices.values()]
    .filter((i) => i.customerId === customer.id)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10)
    .map(
      (i) =>
        `<tr><td>${escapeHtml(i.createdAt)}</td><td>${escapeHtml(i.kind)} / ${escapeHtml(i.billingMode)}</td><td>${escapeHtml(formatAmount(i.amountMinor, i.currency))}</td><td>${escapeHtml(i.status)}</td></tr>`
    )
    .join('');

  return `<table class="state">${rows.join('')}</table>
<h3>Latest invoices</h3>
${invoices ? `<table class="invoices"><tr><th>Created</th><th>Kind</th><th>Amount</th><th>Status</th></tr>${invoices}</table>` : '<p>No invoices.</p>'}`;
}

function renderPage({
  user,
  users,
  done
}: {
  user: MockUser | undefined;
  users: MockUser[];
  done: unknown;
}): string {
  const state = getState();
  const plans = [...state.plans.values()].filter(
    (p) => p.key !== FREE_PLAN_KEY
  );
  const flags = [...state.featureFlags.values()];
  const userOptions = users
    .map((u) =>
      option(u.id, `${u.email} (${u.locale ?? 'en'})`, u.id === user?.id)
    )
    .join('');
  const uid = escapeHtml(user?.id ?? '');
  const providerStatus = BILLING_PROVIDER_FLAGS.map(
    ({ provider, enabledFlagKey }) => {
      const on = flags.find((f) => f.key === enabledFlagKey)?.enabled ?? false;

      return `<form data-action="provider"><input type="hidden" name="provider" value="${provider}"><input type="hidden" name="enabled" value="${String(!on)}">${provider}: <strong>${on ? 'enabled' : 'disabled'}</strong> <button type="submit">${on ? 'Disable' : 'Enable'}</button></form>`;
    }
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Billing lab</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.4; }
section { border: 1px solid #ccc; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1rem; }
h2 { margin-top: 0; font-size: 1.1rem; }
form { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin: 0.5rem 0; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 0.25rem 0.5rem; border-bottom: 1px solid #eee; vertical-align: top; }
.state th { width: 14rem; }
.done { background: #e8f5e9; padding: 0.5rem 1rem; border-radius: 0.5rem; }
.error { background: #ffebee; padding: 0.5rem 1rem; border-radius: 0.5rem; }
.hint { color: #555; font-size: 0.9rem; }
</style>
</head>
<body data-user-id="${uid}">
<h1>Billing lab</h1>
<p class="hint">Mock server only. Sign in to the app as the user in another tab, change the state here, then reload
<a href="/billing">/billing</a> or <a href="/billing/settings">/billing/settings</a>.</p>
${typeof done === 'string' && done ? `<p class="done" role="status">${escapeHtml(done)}</p>` : ''}
<p class="error" role="alert" hidden></p>

<section>
<h2>User</h2>
<form method="get" action="">
<select name="userId">${userOptions}</select>
<button type="submit">Show</button>
</form>
${user ? renderState(user) : ''}
</section>

${
  user
    ? `<section>
<h2>Put the user in a state</h2>
<form data-action="preset">
<input type="hidden" name="userId" value="${uid}">
<select name="preset">${BILLING_PRESETS.map((p) => option(p, PRESET_LABELS[p])).join('')}</select>
<select name="provider">${option('auto', 'Provider of the region')}${PROVIDERS.map((p) => option(p, p)).join('')}</select>
<button type="submit">Apply</button>
</form>
<p class="hint">Each state starts from Free: the open subscription closes first. YooKassa is self-managed (RUB), Paddle is provider-managed (USD).</p>
</section>

<section>
<h2>Usage and credits</h2>
<form data-action="usage">
<input type="hidden" name="userId" value="${uid}">
<input type="number" name="quantity" min="1" value="100" aria-label="Units">
<button type="submit">Use units (takes credits)</button>
</form>
<form data-action="credits">
<input type="hidden" name="userId" value="${uid}">
<input type="number" name="units" min="1" value="500" aria-label="Credits">
<button type="submit">Add credits</button>
</form>
</section>

<section>
<h2>Renewal clock</h2>
<p class="hint">Closes the current period now, as the renewal scheduler does at the period end.</p>
<form data-action="renewal">
<input type="hidden" name="userId" value="${uid}">
<input type="hidden" name="outcome" value="success">
<button type="submit">Renew: the charge succeeds</button>
</form>
<form data-action="renewal">
<input type="hidden" name="userId" value="${uid}">
<input type="hidden" name="outcome" value="failure">
<button type="submit">Renew: the charge fails (dunning)</button>
</form>
</section>`
    : ''
}

<section>
<h2>Catalog and providers</h2>
<form data-action="trial">
<select name="planKey">${plans.map((p) => option(p.key, `${p.name} (now ${p.trialDays} trial days)`)).join('')}</select>
<input type="number" name="days" min="0" value="14" aria-label="Trial days">
<button type="submit">Set trial days</button>
</form>
${providerStatus}
<form data-action="reset">
<button type="submit">Reset the whole mock state</button>
</form>
</section>

<script>
const base = location.pathname.replace(/\\/$/, '');
for (const form of document.querySelectorAll('form[data-action]')) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const response = await fetch(base + '/' + form.dataset.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const { message } = await response.json();
    if (!response.ok) {
      const error = document.querySelector('.error');
      error.textContent = message;
      error.hidden = false;
      return;
    }
    const params = new URLSearchParams({ userId: document.body.dataset.userId, done: message });
    location.href = base + '?' + params.toString();
  });
}
</script>
</body>
</html>`;
}

export default router;
