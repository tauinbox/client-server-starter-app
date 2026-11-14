import { randomUUID } from 'crypto';
import {
  BILLING_PROVIDER_FLAGS,
  ENTITLED_SUBSCRIPTION_STATUSES
} from '@app/shared/constants';
import type { BillingProviderId } from '@app/shared/types';
import { getState } from '../state';
import type { MockInvoice, MockSubscription } from '../types';
import { nextPeriodEnd } from '../utils/period';
import { notifyEntitlementsChanged } from './billing-settle.helpers';

// The test and manual-check clock of the mock billing. The control routes
// (E2E) and the billing lab page (manual checks) share these steps, so the
// two drive the same state changes.

// Mirrors the server's dunning policy (renewal-queue.constants).
const DUNNING_MAX_ATTEMPTS = 3;

export type RenewalOutcome = 'success' | 'failure';

/**
 * The entitled subscription that a renewal scan may charge: by explicit id,
 * else the newest one of the user. A canceled row is never addressable.
 */
export function findRenewableSubscription({
  userId,
  subscriptionId
}: {
  userId?: string;
  subscriptionId?: string;
}): MockSubscription | undefined {
  const state = getState();
  const byId = subscriptionId
    ? state.billingSubscriptions.get(subscriptionId)
    : undefined;

  if (byId && ENTITLED_SUBSCRIPTION_STATUSES.includes(byId.status)) {
    return byId;
  }

  if (!userId) return undefined;

  const customer = state.billingCustomers
    .values()
    .find((c) => c.userId === userId);

  return customer
    ? [...state.billingSubscriptions.values()]
        .filter(
          (s) =>
            s.customerId === customer.id &&
            ENTITLED_SUBSCRIPTION_STATUSES.includes(s.status)
        )
        .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : undefined;
}

/**
 * Treats the current period of the subscription as due NOW and runs one
 * scheduler pass on it, with the period-close semantics of the server.
 * `success` charges and advances: the subscription gets a paid invoice at the
 * plan price for the NEW period.
 * `failure` is a declined off-session charge: past_due and dunning, then
 * canceled when the attempts are exhausted. Returns null when the plan or its
 * price is missing.
 */
export function advanceRenewal(
  subscription: MockSubscription,
  outcome: RenewalOutcome
): MockSubscription | null {
  const state = getState();
  const now = new Date();
  const nowIso = now.toISOString();

  if (outcome === 'failure') {
    const attempts = (subscription.dunningAttempts ?? 0) + 1;

    subscription.dunningAttempts = attempts;
    subscription.status =
      attempts >= DUNNING_MAX_ATTEMPTS ? 'canceled' : 'past_due';

    if (subscription.status === 'canceled') {
      subscription.cancelAtPeriodEnd = false;
    }

    subscription.updatedAt = nowIso;
    notifyEntitlementsChanged(subscription.customerId);

    return subscription;
  }

  const plan = state.plans.values().find((p) => p.key === subscription.planKey);
  const price = plan?.prices[subscription.provider];

  if (!plan || !price) return null;

  // Cancel-at-period-end: the boundary closes the row instead of opening
  // another period.
  if (subscription.cancelAtPeriodEnd) {
    subscription.status = 'canceled';
    subscription.updatedAt = nowIso;
    notifyEntitlementsChanged(subscription.customerId);

    return subscription;
  }

  // The clock advance anchors the boundary at NOW: the new period is
  // [now, now + interval). The new end still lands on the billing day, as the
  // server's renewal does.
  // A trial converts into its first paid period, which re-anchors the billing
  // day there - the same rule the server's renewal applies at trial_end.
  const billingAnchor =
    subscription.status === 'trialing'
      ? now
      : new Date(
          subscription.billingAnchorAt ?? subscription.currentPeriodStart
        );
  const newEnd = nextPeriodEnd(billingAnchor, now, plan.interval);

  const invoice: MockInvoice = {
    id: randomUUID(),
    customerId: subscription.customerId,
    subscriptionId: subscription.id,
    provider: subscription.provider,
    providerInvoiceRef: `in_${randomUUID()}`,
    amountMinor: price.amountMinor,
    currency: price.currency,
    status: 'paid',
    billingMode: subscription.billingMode,
    kind: 'subscription',
    productId: null,
    periodStart: nowIso,
    periodEnd: newEnd.toISOString(),
    paidAt: nowIso,
    receiptRef: null,
    createdAt: nowIso,
    updatedAt: nowIso
  };

  state.billingInvoices.set(invoice.id, invoice);

  subscription.status = 'active';
  subscription.trialEnd = null;
  subscription.dunningAttempts = 0;
  subscription.currentPeriodStart = nowIso;
  subscription.currentPeriodEnd = newEnd.toISOString();
  subscription.billingAnchorAt = billingAnchor.toISOString();
  subscription.updatedAt = nowIso;
  notifyEntitlementsChanged(subscription.customerId);

  return subscription;
}

/**
 * Sets the admin kill-switch flag of one billing provider. Returns false for
 * an unknown provider.
 */
export function setProviderEnabled(
  provider: string,
  enabled: boolean
): provider is BillingProviderId {
  const flagKey = BILLING_PROVIDER_FLAGS.find(
    (p) => p.provider === provider
  )?.enabledFlagKey;

  if (!flagKey) return false;

  for (const flag of getState().featureFlags.values()) {
    if (flag.key === flagKey) flag.enabled = enabled;
  }

  return true;
}
