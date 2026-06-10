import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { And, LessThan, MoreThanOrEqual } from 'typeorm';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { UsageRecord } from '../entities/usage-record.entity';
import type { BillingPeriod } from './rating-strategy.interface';
import { UsageRating } from './usage-rating.strategy';

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    customerId: 'cust-1',
    provider: 'yookassa',
    billingMode: 'usage',
    ...overrides
  } as Subscription;
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    key: 'usage',
    name: 'Pay as you go',
    billingMode: 'usage',
    meterKey: 'api_calls',
    prices: {
      yookassa: {
        currency: 'RUB',
        amountMinor: 0,
        unitPriceMinor: 200,
        includedUnits: 100
      }
    },
    ...overrides
  } as Plan;
}

const PERIOD: BillingPeriod = {
  start: new Date('2026-06-01T00:00:00Z'),
  end: new Date('2026-07-01T00:00:00Z')
};

describe('UsageRating', () => {
  let rating: UsageRating;
  let sum: jest.Mock;

  beforeEach(async () => {
    sum = jest.fn().mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsageRating,
        { provide: getRepositoryToken(UsageRecord), useValue: { sum } }
      ]
    }).compile();

    rating = moduleRef.get(UsageRating);
  });

  it('aggregates the subscription’s records inside [start, end)', async () => {
    sum.mockResolvedValue(150);

    await rating.summarizeForPeriod(makeSubscription(), makePlan(), PERIOD);

    expect(sum).toHaveBeenCalledWith('quantity', {
      subscriptionId: 'sub-1',
      occurredAt: And(MoreThanOrEqual(PERIOD.start), LessThan(PERIOD.end))
    });
  });

  it('rates zero usage (no records) as a zero amount with no receipt lines', async () => {
    sum.mockResolvedValue(null);

    const summary = await rating.summarizeForPeriod(
      makeSubscription(),
      makePlan(),
      PERIOD
    );

    expect(summary).toMatchObject({
      totalUnits: 0,
      includedUnits: 100,
      billableUnits: 0,
      unitPriceMinor: 200,
      amountMinor: 0,
      currency: 'RUB',
      receiptItems: []
    });
  });

  it('charges nothing while usage stays within the included units', async () => {
    sum.mockResolvedValue(99);

    const summary = await rating.summarizeForPeriod(
      makeSubscription(),
      makePlan(),
      PERIOD
    );

    expect(summary.totalUnits).toBe(99);
    expect(summary.billableUnits).toBe(0);
    expect(summary.amountMinor).toBe(0);
    expect(summary.receiptItems).toEqual([]);
  });

  it('charges nothing at exactly the included-units boundary', async () => {
    sum.mockResolvedValue(100);

    const summary = await rating.summarizeForPeriod(
      makeSubscription(),
      makePlan(),
      PERIOD
    );

    expect(summary.billableUnits).toBe(0);
    expect(summary.amountMinor).toBe(0);
  });

  it('charges only the overage beyond the included units', async () => {
    sum.mockResolvedValue(142);

    const summary = await rating.summarizeForPeriod(
      makeSubscription(),
      makePlan(),
      PERIOD
    );

    expect(summary.totalUnits).toBe(142);
    expect(summary.billableUnits).toBe(42);
    expect(summary.amountMinor).toBe(8400);
    expect(summary.receiptItems).toEqual([
      {
        description: 'Pay as you go: api_calls × 42',
        amountMinor: 8400,
        quantity: 1
      }
    ]);
  });

  it('treats a price without includedUnits/unitPriceMinor as zero values', async () => {
    sum.mockResolvedValue(10);

    const summary = await rating.summarizeForPeriod(
      makeSubscription(),
      makePlan({ prices: { yookassa: { currency: 'RUB', amountMinor: 0 } } }),
      PERIOD
    );

    expect(summary.billableUnits).toBe(10);
    expect(summary.amountMinor).toBe(0);
    expect(summary.receiptItems).toEqual([]);
  });

  it('exposes the rated amount through the RatingStrategy contract', async () => {
    sum.mockResolvedValue(142);

    const rated = await rating.amountForPeriod(
      makeSubscription(),
      makePlan(),
      PERIOD
    );

    expect(rated).toEqual({
      amountMinor: 8400,
      receiptItems: [
        {
          description: 'Pay as you go: api_calls × 42',
          amountMinor: 8400,
          quantity: 1
        }
      ]
    });
  });

  it('rejects a plan with no price for the subscription’s provider', async () => {
    await expect(
      rating.summarizeForPeriod(
        makeSubscription({ provider: 'paddle' }),
        makePlan(),
        PERIOD
      )
    ).rejects.toThrow('no price for provider "paddle"');
    expect(sum).not.toHaveBeenCalled();
  });

  it('still rejects proration as M3 work', () => {
    expect(() => rating.prorate()).toThrow('Usage-plan proration (M3)');
  });
});
