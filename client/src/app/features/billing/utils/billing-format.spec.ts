import type { PlanPrice, PlanResponse } from '@app/shared/types';
import {
  formatMoney,
  planPriceFor,
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
});
