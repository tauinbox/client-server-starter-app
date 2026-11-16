import type { CountryCode } from '../constants/data-region.constants';
import type {
  BillingProviderId,
  BillingRegion,
  PlanPrice
} from '../types/billing.types';
import { Money } from './money';

const DAY_MS = 86_400_000;

/** An instant as the server holds it (`Date`) or as the mock holds it (ISO text). */
type Instant = Date | string;

function epochMs(at: Instant): number {
  return new Date(at).getTime();
}

export interface BillingGeo {
  country: string;
  currency: string;
}

function geoFromCountry(country: string): BillingGeo {
  return { country, currency: country === 'RU' ? 'RUB' : 'USD' };
}

/** Maps a locale to a billing country and currency. */
export function geoFromLocale(locale: string): BillingGeo {
  return geoFromCountry(locale.toLowerCase().startsWith('ru') ? 'RU' : 'US');
}

/**
 * The billing country of a user is the declared country of residence. An
 * account with no declaration (created by an administrator) falls back to its
 * locale.
 */
export function billingGeo(user: {
  residenceCountry: CountryCode | null;
  locale: string;
}): BillingGeo {
  return user.residenceCountry
    ? geoFromCountry(user.residenceCountry)
    : geoFromLocale(user.locale);
}

/** Geo default: country code 'RU' -> YooKassa, everywhere else -> Paddle. */
export function geoDefault(country: string): BillingProviderId {
  return country.toUpperCase() === 'RU' ? 'yookassa' : 'paddle';
}

/** Region selector -> provider override. */
export function overrideForRegion(
  region: BillingRegion
): BillingProviderId | null {
  if (region === 'ru') return 'yookassa';

  if (region === 'world') return 'paddle';

  return null;
}

/** Provider override -> region selector. */
export function regionForOverride(
  override: BillingProviderId | null
): BillingRegion {
  if (override === 'yookassa') return 'ru';

  if (override === 'paddle') return 'world';

  return 'auto';
}

/**
 * The boundary a self-managed renewal charges at: `trialEnd` for a trial,
 * else the end of the current period.
 */
export function renewalAnchor<T extends Instant>(subscription: {
  status: string;
  trialEnd: T | null;
  currentPeriodEnd: T;
}): T {
  return subscription.status === 'trialing' && subscription.trialEnd
    ? subscription.trialEnd
    : subscription.currentPeriodEnd;
}

/** The part of a plan that proration reads. */
interface PricedPlan {
  prices: Partial<
    Record<BillingProviderId, Pick<PlanPrice, 'amountMinor' | 'currency'>>
  >;
}

export interface ProrationInput {
  fromPlan: PricedPlan;
  toPlan: PricedPlan;
  provider: BillingProviderId;
  periodStart: Instant;
  periodEnd: Instant;
  now: Instant;
}

export interface ProrationAmounts {
  /** Whole days left in the current period (a started day counts as remaining). */
  remainderDays: number;
  totalDays: number;
  currency: string;
  /** Unused remainder of the fixed price of the old plan, to refund. */
  refundMinor: number;
  /** The fixed price of the new plan prorated over the remainder, to charge. */
  chargeMinor: number;
}

/**
 * Self-managed plan-change proration: immediate switch, refund-and-recharge,
 * whole-day granularity, no credit carry-forward. Both legs use the same
 * remainder.
 *
 * Rounding policy (applies to both legs): each leg is floored to whole minor
 * units, so the sub-minor-unit remainder of each leg stays with the merchant.
 * Flooring the refund alone would favour the merchant twice; rounding the
 * refund up would let a repeated upgrade/downgrade cycle skim a minor unit per
 * switch. Day counting goes the other way: a started day counts as remaining
 * (`ceil`), so the buyer is refunded for the day of the switch.
 */
export function prorationAmounts(input: ProrationInput): ProrationAmounts {
  const { fromPlan, toPlan, provider } = input;
  const periodStart = epochMs(input.periodStart);
  const periodEnd = epochMs(input.periodEnd);

  const totalDays = Math.max(1, Math.round((periodEnd - periodStart) / DAY_MS));
  const remainderDays = Math.min(
    totalDays,
    Math.max(0, Math.ceil((periodEnd - epochMs(input.now)) / DAY_MS))
  );

  const prorate = (plan: PricedPlan): number =>
    Money.fromMinor(plan.prices[provider]?.amountMinor ?? 0)
      .mulInt(remainderDays)
      .divFloor(totalDays)
      .toNumber();

  return {
    remainderDays,
    totalDays,
    currency:
      toPlan.prices[provider]?.currency ??
      fromPlan.prices[provider]?.currency ??
      'USD',
    refundMinor: prorate(fromPlan),
    chargeMinor: prorate(toPlan)
  };
}
