import type {
  BillingProviderId,
  PlanPrice,
  PlanResponse
} from '@app/shared/types';

/**
 * Format an integer minor-unit amount as a localized currency string. Money is
 * stored in minor units (design §3); this divides by the currency's minor-unit
 * scale (2 for RUB/USD; 0 for zero-decimal currencies like JPY) and renders via
 * `Intl.NumberFormat`. `locale` follows the active UI language.
 */
export function formatMoney(
  amountMinor: number,
  currency: string,
  locale: string
): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency
  });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountMinor / 10 ** fractionDigits);
}

/**
 * The provider whose price/currency should be shown. Authenticated callers have
 * a resolved provider from `GET /billing/region`; anonymous visitors fall back
 * to a language heuristic (ru → yookassa/RUB, otherwise paddle/USD).
 */
export function resolveDisplayProvider(
  effectiveProvider: BillingProviderId | null,
  lang: string
): BillingProviderId {
  if (effectiveProvider) return effectiveProvider;
  return lang.toLowerCase().startsWith('ru') ? 'yookassa' : 'paddle';
}

/**
 * Pick a plan's price for the resolved provider, falling back to any available
 * price so a plan never renders priceless if only one provider is priced.
 */
export function planPriceFor(
  plan: PlanResponse,
  provider: BillingProviderId
): PlanPrice | null {
  return plan.prices[provider] ?? Object.values(plan.prices)[0] ?? null;
}
