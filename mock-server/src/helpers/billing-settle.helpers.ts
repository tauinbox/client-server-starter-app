import { randomUUID } from 'crypto';
import type { BillingProviderId } from '@app/shared/types';
import { getState } from '../state';
import { pushToUser } from '../sse-hub';
import { addInterval } from '../utils/period';
import type {
  MockCustomer,
  MockCustomerGrant,
  MockInvoice,
  MockPaymentMethod,
  MockPlan,
  MockPurchaseSession,
  MockSubscription,
  MockUser
} from '../types';

/**
 * Mirrors the server's entitlement-changed listener: every billing change that
 * moves what a plan grants tells the affected client so its advisory mirror
 * does not sit stale. Scoped to the one owner - never a broadcast.
 */
export function notifyEntitlementsChanged(customerId: string): void {
  const userId = getState().billingCustomers.get(customerId)?.userId;
  if (!userId) return;
  pushToUser(userId, { type: 'entitlements_updated', userId });
}

/**
 * Settles a paid plan checkout the way the provider webhook would. Idempotently
 * brings the subscription of the user to `status`, with a default payment
 * method and a paid invoice. A new customer gets the provider of the profile
 * locale; `provider` replaces the provider of the customer for the
 * subscription, because a region override changes the provider of a checkout.
 */
export function activateSubscription(
  user: MockUser,
  plan: MockPlan,
  status: MockSubscription['status'],
  provider?: BillingProviderId
): MockSubscription {
  const state = getState();
  const now = new Date();
  const nowIso = now.toISOString();
  const periodEnd = addInterval(now, plan.interval);

  const isRu = (user.locale ?? 'en').toLowerCase().startsWith('ru');
  let customer = [...state.billingCustomers.values()].find(
    (c) => c.userId === user.id
  );
  if (!customer) {
    customer = {
      id: randomUUID(),
      userId: user.id,
      provider: isRu ? 'yookassa' : 'paddle',
      providerOverride: null,
      country: isRu ? 'RU' : 'US',
      currency: isRu ? 'RUB' : 'USD',
      defaultPaymentMethodId: null,
      createdAt: nowIso,
      updatedAt: nowIso
    } satisfies MockCustomer;
    state.billingCustomers.set(customer.id, customer);
  }
  const paidWith = provider ?? customer.provider;

  // Default payment method (created once).
  if (!customer.defaultPaymentMethodId) {
    const method: MockPaymentMethod = {
      id: randomUUID(),
      customerId: customer.id,
      provider: paidWith,
      providerMethodRef: `pm_${randomUUID()}`,
      brand: 'visa',
      last4: '4242',
      isDefault: true,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    state.billingPaymentMethods.set(method.id, method);
    customer.defaultPaymentMethodId = method.id;
  }

  // Reuse the latest open subscription if present, else create one.
  const customerId = customer.id;
  const existing = [...state.billingSubscriptions.values()]
    .filter((s) => s.customerId === customerId && s.status !== 'canceled')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const subscription: MockSubscription = existing ?? {
    id: randomUUID(),
    customerId,
    planKey: plan.key,
    provider: paidWith,
    billingMode: plan.billingMode,
    status,
    lifecycleOwner: paidWith === 'yookassa' ? 'self' : 'provider',
    currentPeriodStart: nowIso,
    currentPeriodEnd: periodEnd.toISOString(),
    cancelAtPeriodEnd: false,
    trialEnd: null,
    paymentMethodId: customer.defaultPaymentMethodId,
    providerSubscriptionId: null,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  subscription.planKey = plan.key;
  subscription.billingMode = plan.billingMode;
  subscription.status = status;
  subscription.paymentMethodId = customer.defaultPaymentMethodId;
  subscription.currentPeriodEnd = periodEnd.toISOString();
  // The seeded boundary is re-derived from now, so the billing day is too.
  if (subscription.lifecycleOwner === 'self') {
    subscription.billingAnchorAt = nowIso;
  }
  subscription.updatedAt = nowIso;
  state.billingSubscriptions.set(subscription.id, subscription);

  // A paid invoice for the plan price on the provider of the subscription.
  const price =
    plan.prices[subscription.provider] ?? Object.values(plan.prices)[0];
  const invoice: MockInvoice = {
    id: randomUUID(),
    customerId,
    subscriptionId: subscription.id,
    provider: subscription.provider,
    providerInvoiceRef: `in_${randomUUID()}`,
    amountMinor: price?.amountMinor ?? 0,
    currency: price?.currency ?? 'USD',
    status: 'paid',
    billingMode: plan.billingMode,
    kind: 'subscription',
    productId: null,
    periodStart: nowIso,
    periodEnd: periodEnd.toISOString(),
    paidAt: nowIso,
    receiptRef: null,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  state.billingInvoices.set(invoice.id, invoice);

  notifyEntitlementsChanged(customerId);
  return subscription;
}

/**
 * Settles a pending one-time purchase exactly the way the server's webhook
 * reducer would: a paid `one_time` invoice keyed by the provider payment
 * reference, plus a CustomerGrant when the product is an entitlement-granting
 * sku, plus a credit-balance top-up when it is a credit pack. Settling deletes
 * the session, mirroring the reducer's once-per-payment idempotency.
 */
export function settlePurchase(session: MockPurchaseSession): MockInvoice {
  const state = getState();
  const nowIso = new Date().toISOString();
  const invoice: MockInvoice = {
    id: randomUUID(),
    customerId: session.customerId,
    subscriptionId: null,
    provider: session.provider,
    providerInvoiceRef: session.sessionRef,
    amountMinor: session.amountMinor,
    currency: session.currency,
    status: 'paid',
    billingMode: 'fixed',
    kind: 'one_time',
    productId: session.productId,
    periodStart: nowIso,
    periodEnd: nowIso,
    paidAt: nowIso,
    receiptRef: null,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  state.billingInvoices.set(invoice.id, invoice);

  const product = state.billingProducts.get(session.productId);
  if (product?.type === 'sku' && product.grant?.entitlement) {
    const grant: MockCustomerGrant = {
      id: randomUUID(),
      customerId: session.customerId,
      entitlement: product.grant.entitlement,
      sourceInvoiceId: invoice.id,
      expiresAt: product.grant.durationDays
        ? new Date(
            Date.now() + product.grant.durationDays * 86_400_000
          ).toISOString()
        : null,
      revokedAt: null,
      createdAt: nowIso
    };
    state.billingCustomerGrants.set(grant.id, grant);
  }

  if (product?.type === 'credits' && product.grant?.credits) {
    const balance = state.billingCreditBalances.get(session.customerId);
    if (balance) {
      balance.balanceUnits += product.grant.credits;
      balance.updatedAt = nowIso;
    } else {
      state.billingCreditBalances.set(session.customerId, {
        customerId: session.customerId,
        balanceUnits: product.grant.credits,
        updatedAt: nowIso
      });
    }
  }

  state.billingPurchaseSessions.delete(session.sessionRef);
  notifyEntitlementsChanged(session.customerId);
  return invoice;
}
