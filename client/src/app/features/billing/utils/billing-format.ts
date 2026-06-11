import type {
  BillingProviderId,
  PlanPrice,
  PlanResponse,
  ProductPrice,
  ProductResponse
} from '@app/shared/types';

/**
 * Format an integer minor-unit amount as a localized currency string. Money is
 * stored in minor units; this divides by the currency's minor-unit
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

/**
 * Pick a one-time product's price entry for the resolved provider (fixed
 * amount for sku/credits; amount bounds for custom), with the same any-price
 * fallback as `planPriceFor`.
 */
export function productPriceFor(
  product: ProductResponse,
  provider: BillingProviderId
): ProductPrice | null {
  return product.prices[provider] ?? Object.values(product.prices)[0] ?? null;
}

/** The currency's minor-unit scale (2 for RUB/USD, 0 for e.g. JPY). */
export function minorUnitScale(currency: string): number {
  return (
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/**
 * Parse a user-typed major-unit amount ("1500", "1500.50", RU "1500,50")
 * into integer minor units, or `null` when the text is not a plain positive
 * number. Validation against the product bounds is the caller's.
 */
export function parseAmountToMinor(
  text: string,
  currency: string
): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const major = Number(normalized);
  if (!Number.isFinite(major) || major <= 0) return null;
  return Math.round(major * 10 ** minorUnitScale(currency));
}
