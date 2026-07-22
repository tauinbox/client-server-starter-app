import type {
  PlanPrice,
  PlanResponse,
  ProductResponse
} from '@app/shared/types';
import { minorUnitScale } from '@app/shared/utils/money';
import {
  formatMoney,
  formatUnits,
  parseAmountToMinor,
  planPriceFor,
  productPriceFor,
  resolveDisplayProvider
} from './billing-format';

function makePlan(prices: PlanResponse['prices']): PlanResponse {
  return {
    id: 'plan-1',
    key: 'pro',
    name: 'Pro',
    description: null,
    billingMode: 'fixed',
    interval: 'month',
    meterKey: null,
    entitlements: [],
    limits: null,
    trialDays: 0,
    active: true,
    prices,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  };
}

const usd: PlanPrice = { currency: 'USD', amountMinor: 1200 };
const rub: PlanPrice = { currency: 'RUB', amountMinor: 99000 };

describe('billing-format', () => {
  describe('formatMoney', () => {
    it('divides minor units by the 2-decimal scale for RUB/USD', () => {
      expect(formatMoney(99000, 'RUB', 'ru')).toContain('990');
      expect(formatMoney(1200, 'USD', 'en')).toContain('12');
    });

    it('renders zero amounts', () => {
      expect(formatMoney(0, 'USD', 'en')).toContain('0');
    });
  });

  describe('formatUnits', () => {
    it('groups digits per locale', () => {
      expect(formatUnits(1240, 'en')).toBe('1,240');
      // ru groups with a (narrow) no-break space - match any whitespace to
      // stay stable across ICU versions.
      expect(formatUnits(1240, 'ru')).toMatch(/^1\s240$/);
    });

    it('keeps the sign of an overdrawn balance', () => {
      expect(formatUnits(-200, 'en')).toBe('-200');
    });
  });

  describe('resolveDisplayProvider', () => {
    it('prefers the resolved provider when present', () => {
      expect(resolveDisplayProvider('yookassa', 'en')).toBe('yookassa');
      expect(resolveDisplayProvider('paddle', 'ru')).toBe('paddle');
    });

    it('falls back to a language heuristic when none is resolved', () => {
      expect(resolveDisplayProvider(null, 'ru')).toBe('yookassa');
      expect(resolveDisplayProvider(null, 'en')).toBe('paddle');
    });
  });

  describe('planPriceFor', () => {
    it('returns the price for the requested provider', () => {
      const plan = makePlan({ paddle: usd, yookassa: rub });
      expect(planPriceFor(plan, 'yookassa')?.currency).toBe('RUB');
    });

    it('falls back to any available price when the provider is missing', () => {
      const plan = makePlan({ paddle: usd });
      expect(planPriceFor(plan, 'yookassa')?.currency).toBe('USD');
    });

    it('returns null when no prices exist', () => {
      expect(planPriceFor(makePlan({}), 'paddle')).toBeNull();
    });
  });

  describe('productPriceFor', () => {
    function makeProduct(prices: ProductResponse['prices']): ProductResponse {
      return {
        id: 'prod-1',
        key: 'donation',
        name: 'Donation',
        description: null,
        type: 'custom',
        prices,
        grant: null,
        active: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      };
    }

    it('returns the entry for the requested provider, with fallback', () => {
      const product = makeProduct({
        paddle: { currency: 'USD', minAmountMinor: 100, maxAmountMinor: 50000 }
      });
      expect(productPriceFor(product, 'paddle')?.minAmountMinor).toBe(100);
      expect(productPriceFor(product, 'yookassa')?.currency).toBe('USD');
      expect(productPriceFor(makeProduct({}), 'paddle')).toBeNull();
    });
  });

  describe('minorUnitScale', () => {
    it('is 2 for RUB/USD and 0 for zero-decimal currencies', () => {
      expect(minorUnitScale('USD')).toBe(2);
      expect(minorUnitScale('RUB')).toBe(2);
      expect(minorUnitScale('JPY')).toBe(0);
    });
  });

  describe('parseAmountToMinor', () => {
    it('parses integers and up-to-2-decimal amounts into minor units', () => {
      expect(parseAmountToMinor('15', 'USD')).toBe(1500);
      expect(parseAmountToMinor('15.5', 'USD')).toBe(1550);
      expect(parseAmountToMinor('15.55', 'USD')).toBe(1555);
      expect(parseAmountToMinor(' 1500 ', 'RUB')).toBe(150000);
    });

    it('accepts a comma decimal separator', () => {
      expect(parseAmountToMinor('12,34', 'RUB')).toBe(1234);
    });

    it('rejects junk, negatives, zero and over-precise input', () => {
      expect(parseAmountToMinor('abc', 'USD')).toBeNull();
      expect(parseAmountToMinor('-5', 'USD')).toBeNull();
      expect(parseAmountToMinor('0', 'USD')).toBeNull();
      expect(parseAmountToMinor('1.234', 'USD')).toBeNull();
      expect(parseAmountToMinor('', 'USD')).toBeNull();
    });

    it('follows the currency scale instead of assuming two decimals', () => {
      // Zero-decimal: the minor unit IS the major unit, and a fractional
      // amount must be rejected rather than silently rounded to 1501.
      expect(parseAmountToMinor('1500', 'JPY')).toBe(1500);
      expect(parseAmountToMinor('1500.5', 'JPY')).toBeNull();
      // Three-decimal: 1.234 KWD is 1234 fils, not invalid input.
      expect(parseAmountToMinor('1.234', 'KWD')).toBe(1234);
      expect(parseAmountToMinor('1.2345', 'KWD')).toBeNull();
    });
  });
});
