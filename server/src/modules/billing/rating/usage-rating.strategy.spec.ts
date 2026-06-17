import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
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
  let getRawOne: jest.Mock;
  let qb: {
    select: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    getRawOne: jest.Mock;
  };
  let createQueryBuilder: jest.Mock;

  /** The bigint SUM is decoded from a numeric string — mock that wire shape. */
  function mockTotal(total: number): void {
    getRawOne.mockResolvedValue({ total: String(total) });
  }

  beforeEach(async () => {
    getRawOne = jest.fn().mockResolvedValue({ total: '0' });
    qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne
    };
    createQueryBuilder = jest.fn().mockReturnValue(qb);

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsageRating,
        {
          provide: getRepositoryToken(UsageRecord),
          useValue: { createQueryBuilder }
        }
      ]
    }).compile();

    rating = moduleRef.get(UsageRating);
  });

  it('aggregates the subscription’s records inside [start, end)', async () => {
    mockTotal(150);

    await rating.summarizeForPeriod(makeSubscription(), makePlan(), PERIOD);

    expect(createQueryBuilder).toHaveBeenCalledWith('u');
    expect(qb.where).toHaveBeenCalledWith(
      'u.subscriptionId = :subscriptionId',
      {
        subscriptionId: 'sub-1'
      }
    );
    expect(qb.andWhere).toHaveBeenCalledWith('u.occurredAt >= :start', {
      start: PERIOD.start
    });
    expect(qb.andWhere).toHaveBeenCalledWith('u.occurredAt < :end', {
      end: PERIOD.end
    });
  });

  it('rates zero usage (no records) as a zero amount with no receipt lines', async () => {
    mockTotal(0);

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
    mockTotal(99);

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
    mockTotal(100);

    const summary = await rating.summarizeForPeriod(
      makeSubscription(),
      makePlan(),
      PERIOD
    );

    expect(summary.billableUnits).toBe(0);
    expect(summary.amountMinor).toBe(0);
  });

  it('charges only the overage beyond the included units', async () => {
    mockTotal(142);

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
    mockTotal(10);

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
    mockTotal(142);

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

  it('rates an overage product that exceeds int32 without overflow or precision loss', async () => {
    // 50_000 billable units at 50_000 minor each = 2_500_000_000 minor, beyond
    // the old int32 column ceiling (2_147_483_647). The bigint Money path keeps
    // it exact — the pre-fix integer column threw 22003 on the invoice insert.
    mockTotal(50_000);
    const plan = makePlan({
      prices: {
        yookassa: {
          currency: 'RUB',
          amountMinor: 0,
          unitPriceMinor: 50_000,
          includedUnits: 0
        }
      }
    });

    const summary = await rating.summarizeForPeriod(
      makeSubscription(),
      plan,
      PERIOD
    );

    expect(summary.billableUnits).toBe(50_000);
    expect(summary.amountMinor).toBe(2_500_000_000);
  });

  it('rejects a plan with no price for the subscription’s provider', async () => {
    await expect(
      rating.summarizeForPeriod(
        makeSubscription({ provider: 'paddle' }),
        makePlan(),
        PERIOD
      )
    ).rejects.toThrow('no price for provider "paddle"');
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });

  describe('summarizeForPeriodWithCredits', () => {
    it('offsets billable units with partial credits and reprices the remainder', async () => {
      mockTotal(142);

      const summary = await rating.summarizeForPeriodWithCredits(
        makeSubscription(),
        makePlan(),
        PERIOD,
        10
      );

      expect(summary).toMatchObject({
        billableUnits: 42,
        creditUnitsApplied: 10,
        chargedUnits: 32,
        amountMinor: 6400
      });
      expect(summary.receiptItems).toEqual([
        {
          description: 'Pay as you go: api_calls × 32',
          amountMinor: 6400,
          quantity: 1
        }
      ]);
    });

    it('caps the spend at the billable units when credits exceed them', async () => {
      mockTotal(142);

      const summary = await rating.summarizeForPeriodWithCredits(
        makeSubscription(),
        makePlan(),
        PERIOD,
        1000
      );

      expect(summary).toMatchObject({
        creditUnitsApplied: 42,
        chargedUnits: 0,
        amountMinor: 0,
        receiptItems: []
      });
    });

    it('changes nothing with zero credits available', async () => {
      mockTotal(142);

      const summary = await rating.summarizeForPeriodWithCredits(
        makeSubscription(),
        makePlan(),
        PERIOD,
        0
      );

      expect(summary).toMatchObject({
        creditUnitsApplied: 0,
        chargedUnits: 42,
        amountMinor: 8400
      });
    });

    it('ignores a negative available balance (nothing to spend)', async () => {
      mockTotal(142);

      const summary = await rating.summarizeForPeriodWithCredits(
        makeSubscription(),
        makePlan(),
        PERIOD,
        -100
      );

      expect(summary).toMatchObject({
        creditUnitsApplied: 0,
        chargedUnits: 42,
        amountMinor: 8400
      });
    });

    it('spends no credits on a period with no overage', async () => {
      mockTotal(99);

      const summary = await rating.summarizeForPeriodWithCredits(
        makeSubscription(),
        makePlan(),
        PERIOD,
        50
      );

      expect(summary).toMatchObject({
        billableUnits: 0,
        creditUnitsApplied: 0,
        chargedUnits: 0,
        amountMinor: 0
      });
    });
  });
});
