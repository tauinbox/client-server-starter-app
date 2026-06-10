import { ProrationCalculator } from './proration-calculator';
import { Plan } from '../entities/plan.entity';

function makePlan(
  key: string,
  amountMinor: number,
  billingMode: 'fixed' | 'usage' = 'fixed'
): Plan {
  return Object.assign(new Plan(), {
    id: `plan-${key}`,
    key,
    name: key.charAt(0).toUpperCase() + key.slice(1),
    billingMode,
    interval: 'month',
    meterKey: billingMode === 'usage' ? 'api_calls' : null,
    prices: {
      yookassa: {
        currency: 'RUB',
        amountMinor,
        ...(billingMode === 'usage'
          ? { unitPriceMinor: 200, includedUnits: 0 }
          : {})
      }
    }
  });
}

// A 30-day June period; "now" leaves exactly 12 whole days remaining.
const periodStart = new Date('2026-06-01T00:00:00Z');
const periodEnd = new Date('2026-07-01T00:00:00Z');
const now = new Date('2026-06-19T00:00:00Z');

describe('ProrationCalculator', () => {
  const calculator = new ProrationCalculator();
  const pro = makePlan('pro', 99000);
  const business = makePlan('business', 290000);
  const usage = makePlan('usage', 0, 'usage');

  function quote(fromPlan: Plan, toPlan: Plan, at: Date = now) {
    return calculator.quote({
      fromPlan,
      toPlan,
      provider: 'yookassa',
      periodStart,
      periodEnd,
      now: at
    });
  }

  it('computes whole-day remainder and total', () => {
    const q = quote(pro, business);
    expect(q.totalDays).toBe(30);
    expect(q.remainderDays).toBe(12);
  });

  it('upgrade: charges more than it refunds', () => {
    const q = quote(pro, business);
    expect(q.refundMinor).toBe(Math.floor((99000 * 12) / 30)); // 39600
    expect(q.chargeMinor).toBe(Math.floor((290000 * 12) / 30)); // 116000
    expect(q.chargeMinor).toBeGreaterThan(q.refundMinor);
    expect(q.refundItems).toHaveLength(1);
    expect(q.chargeItems).toHaveLength(1);
    expect(q.currency).toBe('RUB');
  });

  it('downgrade: refunds more than it charges', () => {
    const q = quote(business, pro);
    expect(q.refundMinor).toBe(116000);
    expect(q.chargeMinor).toBe(39600);
    expect(q.refundMinor).toBeGreaterThan(q.chargeMinor);
  });

  it('fixed → usage: refund only (usage has no fixed price)', () => {
    const q = quote(pro, usage);
    expect(q.refundMinor).toBe(39600);
    expect(q.chargeMinor).toBe(0);
    expect(q.chargeItems).toHaveLength(0);
  });

  it('usage → fixed: charge only (nothing fixed to refund)', () => {
    const q = quote(usage, pro);
    expect(q.refundMinor).toBe(0);
    expect(q.chargeMinor).toBe(39600);
    expect(q.refundItems).toHaveLength(0);
  });

  it('a started day counts as remaining (ceil)', () => {
    const q = quote(pro, business, new Date('2026-06-18T15:00:00Z'));
    expect(q.remainderDays).toBe(13);
  });

  it('clamps to zero at/after the period end', () => {
    const q = quote(pro, business, new Date('2026-07-01T00:00:00Z'));
    expect(q.remainderDays).toBe(0);
    expect(q.refundMinor).toBe(0);
    expect(q.chargeMinor).toBe(0);
    expect(q.refundItems).toHaveLength(0);
    expect(q.chargeItems).toHaveLength(0);
  });

  it('clamps to the full period right after it starts', () => {
    const q = quote(pro, business, new Date('2026-06-01T00:00:01Z'));
    expect(q.remainderDays).toBe(30);
    expect(q.refundMinor).toBe(99000);
    expect(q.chargeMinor).toBe(290000);
  });
});
