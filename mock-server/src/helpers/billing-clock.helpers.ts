import { randomUUID } from 'crypto';
import {
  BILLING_PROVIDER_FLAGS,
  ENTITLED_SUBSCRIPTION_STATUSES
} from '@app/shared/constants';
import type { BillingProviderId } from '@app/shared/types';
import { meteredWindowStart, rateUsage } from '@app/shared/utils/billing-rules';
import { getState } from '../state';
import type { MockInvoice, MockSubscription, MockUsageRecord } from '../types';
import { nextPeriodEnd } from '../utils/period';
import { billClosingUsagePeriod, sumPlanMeterUnits } from './billing.helpers';
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
 * `success` charges and advances: a fixed subscription gets a paid invoice at
 * the plan price for the NEW period; a usage subscription gets a postpaid
 * invoice for the CLOSED period (records with occurredAt in [window start,
 * now), overage beyond includedUnits at unitPriceMinor, prepaid credits first).
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
    // The server seals usage ingest at the anchor before it rates the window,
    // and the seal outlives the decline: a retry re-rates the same window.
    if (subscription.billingMode === 'usage') {
      subscription.usageSealedUntil = nowIso;
    }

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
  // another period. A postpaid metered period is rated and invoiced first -
  // its units were consumed and are owed.
  if (subscription.cancelAtPeriodEnd) {
    billClosingUsagePeriod(subscription, now);
    subscription.status = 'canceled';
    subscription.updatedAt = nowIso;
    notifyEntitlementsChanged(subscription.customerId);

    return subscription;
  }

  // The clock advance anchors the boundary at NOW: the closed window is
  // [windowStart, now) and the new period [now, now + interval). The new
  // end still lands on the billing day, as the server's renewal does.
  const closedStart = meteredWindowStart(subscription);
  // A trial converts into its first paid period, which re-anchors the billing
  // day there - the same rule the server's renewal applies at trial_end.
  const billingAnchor =
    subscription.status === 'trialing'
      ? now
      : new Date(
          subscription.billingAnchorAt ?? subscription.currentPeriodStart
        );
  const newEnd = nextPeriodEnd(billingAnchor, now, plan.interval);

  let { amountMinor } = price;
  let periodStart = nowIso;
  let periodEnd = newEnd.toISOString();

  if (subscription.billingMode === 'usage') {
    const totalUnits = sumPlanMeterUnits(plan, subscription.id, {
      startIso: closedStart,
      endIso: nowIso
    });
    // The deduction settles with the postpaid invoice below, as the server's
    // spend commit does.
    const balance = state.billingCreditBalances.get(subscription.customerId);
    const rated = rateUsage({
      totalUnits,
      price,
      availableCreditUnits: balance?.balanceUnits ?? 0
    });

    if (balance && rated.creditUnitsApplied > 0) {
      balance.balanceUnits -= rated.creditUnitsApplied;
      balance.updatedAt = nowIso;
    }

    amountMinor = rated.amountMinor;
    periodStart = closedStart;
    periodEnd = nowIso;
  }

  const invoice: MockInvoice = {
    id: randomUUID(),
    customerId: subscription.customerId,
    subscriptionId: subscription.id,
    provider: subscription.provider,
    providerInvoiceRef: `in_${randomUUID()}`,
    amountMinor,
    currency: price.currency,
    status: 'paid',
    billingMode: subscription.billingMode,
    kind: 'subscription',
    productId: null,
    periodStart,
    periodEnd,
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
  delete subscription.meteredFrom;
  subscription.updatedAt = nowIso;
  notifyEntitlementsChanged(subscription.customerId);

  return subscription;
}

/**
 * Records usage against the subscription without the admin ingest endpoint.
 * The default `occurredAt` is the start of the open metered window, not the
 * clock: the window closes at [start, now), so a record stamped "now" and a
 * renewal advanced in the same millisecond drop the record from the window it
 * was seeded for.
 */
export function seedUsage(
  subscription: MockSubscription,
  {
    meterKey = 'api_calls',
    quantity = 1,
    occurredAt,
    idempotencyKey
  }: {
    meterKey?: string;
    quantity?: number;
    occurredAt?: string;
    idempotencyKey?: string;
  } = {}
): MockUsageRecord {
  const now = new Date().toISOString();
  const record: MockUsageRecord = {
    id: randomUUID(),
    customerId: subscription.customerId,
    subscriptionId: subscription.id,
    meterKey,
    quantity,
    occurredAt: occurredAt ?? meteredWindowStart(subscription),
    idempotencyKey: idempotencyKey ?? `seed-${randomUUID()}`,
    recordedAt: now
  };

  getState().billingUsageRecords.set(record.id, record);

  return record;
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
