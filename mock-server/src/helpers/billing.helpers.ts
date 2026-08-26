import { randomUUID } from 'crypto';
import { getState } from '../state';
import type { MockInvoice, MockSubscription } from '../types';

/**
 * Rates and invoices the open metered period a cancellation closes, mirroring
 * the server: a `usage` plan is postpaid, so the units consumed inside
 * `[currentPeriodStart, now)` are owed whether or not the customer stays.
 * Included units and prepaid credits offset the total exactly as the renewal
 * simulation does. Fixed plans prepaid their period and are left alone.
 */
export function billClosingUsagePeriod(
  subscription: MockSubscription,
  now: Date = new Date()
): MockInvoice | null {
  if (subscription.billingMode !== 'usage') return null;

  const state = getState();
  const plan = [...state.plans.values()].find(
    (p) => p.key === subscription.planKey
  );
  const price = plan?.prices[subscription.provider];
  if (!plan || !price) return null;

  const nowIso = now.toISOString();
  const closedStart = subscription.currentPeriodStart;
  if (nowIso <= closedStart) return null;

  // Only the plan's own meter is priced at its rate; a plan naming no meter
  // charges for nothing - the same rule the read endpoint and the server apply.
  const totalUnits = plan.meterKey
    ? [...state.billingUsageRecords.values()]
        .filter(
          (r) =>
            r.subscriptionId === subscription.id &&
            r.meterKey === plan.meterKey &&
            r.occurredAt >= closedStart &&
            r.occurredAt < nowIso
        )
        .reduce((sum, r) => sum + r.quantity, 0)
    : 0;
  const billableUnits = Math.max(0, totalUnits - (price.includedUnits ?? 0));
  const balance = state.billingCreditBalances.get(subscription.customerId);
  const creditUnitsApplied = Math.min(
    Math.max(0, balance?.balanceUnits ?? 0),
    billableUnits
  );
  if (balance && creditUnitsApplied > 0) {
    balance.balanceUnits -= creditUnitsApplied;
    balance.updatedAt = nowIso;
  }

  const invoice: MockInvoice = {
    id: randomUUID(),
    customerId: subscription.customerId,
    subscriptionId: subscription.id,
    provider: subscription.provider,
    providerInvoiceRef: `in_${randomUUID()}`,
    amountMinor:
      (billableUnits - creditUnitsApplied) * (price.unitPriceMinor ?? 0),
    currency: price.currency,
    status: 'paid',
    billingMode: 'usage',
    kind: 'subscription',
    productId: null,
    periodStart: closedStart,
    periodEnd: nowIso,
    paidAt: nowIso,
    receiptRef: null,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  state.billingInvoices.set(invoice.id, invoice);
  return invoice;
}
