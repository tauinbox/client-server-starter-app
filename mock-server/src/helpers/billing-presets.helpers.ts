import type { BillingProviderId } from '@app/shared/types';
import { geoDefault } from '@app/shared/utils/billing-rules';
import { getState } from '../state';
import type { MockSubscription, MockUser } from '../types';
import {
  activateSubscription,
  notifyEntitlementsChanged
} from './billing-settle.helpers';
import { seedUsage } from './billing-clock.helpers';

/**
 * The billing states that the billing lab page can put a user in. Each one is
 * a state that the real flows reach; the lab only skips the steps before it.
 */
export const BILLING_PRESETS = [
  'free',
  'pro',
  'business',
  'usage',
  'usage-with-units',
  'trialing',
  'past-due',
  'canceling'
] as const;

export type BillingPreset = (typeof BILLING_PRESETS)[number];

export function isBillingPreset(value: unknown): value is BillingPreset {
  return BILLING_PRESETS.includes(value as BillingPreset);
}

const PRESET_PLAN: Record<Exclude<BillingPreset, 'free'>, string> = {
  pro: 'pro',
  business: 'business',
  usage: 'usage',
  'usage-with-units': 'usage',
  trialing: 'pro',
  'past-due': 'pro',
  canceling: 'pro'
};

const TRIAL_DAYS = 14;
const PRESET_USAGE_UNITS = 150;

/**
 * Puts the user in the preset state. Every open subscription of the customer
 * closes first, so the preset starts from Free. `provider` null keeps the
 * provider of the region of the customer; a provider sets the region override
 * to match, so the pricing page and the subscription agree.
 */
export function applyBillingPreset(
  user: MockUser,
  {
    preset,
    provider
  }: { preset: BillingPreset; provider: BillingProviderId | null }
): MockSubscription | null {
  const state = getState();
  const nowIso = new Date().toISOString();
  const existing = state.billingCustomers
    .values()
    .find((c) => c.userId === user.id);

  let closed = 0;

  if (existing) {
    for (const sub of state.billingSubscriptions.values()) {
      if (sub.customerId === existing.id && sub.status !== 'canceled') {
        sub.status = 'canceled';
        sub.cancelAtPeriodEnd = false;
        sub.updatedAt = nowIso;
        closed++;
      }
    }
  }

  if (preset === 'free') {
    // A user who is on Free already gets no push: nothing changed.
    if (existing && closed > 0) notifyEntitlementsChanged(existing.id);

    return null;
  }

  const plan = state.plans.values().find((p) => p.key === PRESET_PLAN[preset]);

  if (!plan) return null;

  const status =
    preset === 'trialing'
      ? 'trialing'
      : preset === 'past-due'
        ? 'past_due'
        : 'active';
  const resolved =
    provider ??
    (existing
      ? (existing.providerOverride ?? geoDefault(existing.country))
      : undefined);
  const subscription = activateSubscription(user, plan, {
    status,
    provider: resolved
  });
  const customer = state.billingCustomers.get(subscription.customerId);

  if (customer) {
    customer.providerOverride =
      subscription.provider === geoDefault(customer.country)
        ? null
        : subscription.provider;
  }

  // The trial is the first period: it converts at its end.
  if (preset === 'trialing') {
    subscription.trialEnd = new Date(
      Date.now() + TRIAL_DAYS * 86_400_000
    ).toISOString();
    subscription.currentPeriodEnd = subscription.trialEnd;
  }

  if (preset === 'past-due') subscription.dunningAttempts = 1;

  if (preset === 'canceling') subscription.cancelAtPeriodEnd = true;

  if (preset === 'usage-with-units') {
    seedUsage(subscription, { quantity: PRESET_USAGE_UNITS });
  }

  notifyEntitlementsChanged(subscription.customerId);

  return subscription;
}
