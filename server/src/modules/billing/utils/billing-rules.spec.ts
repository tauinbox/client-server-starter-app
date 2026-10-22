import {
  geoDefault,
  geoFromLocale,
  meteredWindowStart,
  overrideForRegion,
  prorationAmounts,
  rateUsage,
  regionForOverride,
  renewalAnchor,
  usageIngestStart
} from '@app/shared/utils/billing-rules';

function utc(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

describe('geoFromLocale and geoDefault', () => {
  it('maps a Russian locale to RU, RUB and YooKassa', () => {
    expect(geoFromLocale('ru-RU')).toEqual({ country: 'RU', currency: 'RUB' });
    expect(geoDefault(geoFromLocale('RU').country)).toBe('yookassa');
  });

  it('maps any other locale to US, USD and Paddle', () => {
    expect(geoFromLocale('en')).toEqual({ country: 'US', currency: 'USD' });
    expect(geoDefault('us')).toBe('paddle');
  });
});

describe('overrideForRegion and regionForOverride', () => {
  it.each([
    ['ru', 'yookassa'],
    ['world', 'paddle'],
    ['auto', null]
  ] as const)('maps region %s to override %s and back', (region, override) => {
    expect(overrideForRegion(region)).toBe(override);
    expect(regionForOverride(override)).toBe(region);
  });
});

describe('meteredWindowStart', () => {
  const periodStart = utc(2026, 8, 1);

  it('is the period start when no switch moved the window', () => {
    expect(
      meteredWindowStart({ currentPeriodStart: periodStart, meteredFrom: null })
    ).toBe(periodStart);
  });

  it('is the switch moment when a switch moved the window inside the period', () => {
    const switchedAt = utc(2026, 8, 11);
    expect(
      meteredWindowStart({
        currentPeriodStart: periodStart,
        meteredFrom: switchedAt
      })
    ).toBe(switchedAt);
  });

  it('ignores a switch moment left over from an earlier period', () => {
    expect(
      meteredWindowStart({
        currentPeriodStart: periodStart,
        meteredFrom: utc(2026, 7, 20)
      })
    ).toBe(periodStart);
  });

  it('compares ISO text by instant, not by text', () => {
    expect(
      meteredWindowStart({
        currentPeriodStart: '2026-09-01T00:00:00.000Z',
        meteredFrom: '2026-09-01T03:00:00+05:00'
      })
    ).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('usageIngestStart', () => {
  const periodStart = utc(2026, 8, 1);

  it('is the metered window start when no close sealed the window', () => {
    expect(
      usageIngestStart({
        currentPeriodStart: periodStart,
        meteredFrom: null,
        usageSealedUntil: null
      })
    ).toBe(periodStart);
  });

  it('is the seal when a close sealed the window past its start', () => {
    const sealed = utc(2026, 9, 1);
    expect(
      usageIngestStart({
        currentPeriodStart: periodStart,
        meteredFrom: null,
        usageSealedUntil: sealed
      })
    ).toBe(sealed);
  });

  it('ignores a seal that an earlier period left behind', () => {
    const switchedAt = utc(2026, 8, 11);
    expect(
      usageIngestStart({
        currentPeriodStart: periodStart,
        meteredFrom: switchedAt,
        usageSealedUntil: periodStart
      })
    ).toBe(switchedAt);
  });
});

describe('renewalAnchor', () => {
  const trialEnd = utc(2026, 8, 15);
  const currentPeriodEnd = utc(2026, 9, 1);

  it('is the trial end for a trial', () => {
    expect(
      renewalAnchor({ status: 'trialing', trialEnd, currentPeriodEnd })
    ).toBe(trialEnd);
  });

  it('is the period end for a paid period, even with a past trial end', () => {
    expect(
      renewalAnchor({ status: 'active', trialEnd, currentPeriodEnd })
    ).toBe(currentPeriodEnd);
  });
});

describe('prorationAmounts', () => {
  const pro = {
    prices: { yookassa: { amountMinor: 99_000, currency: 'RUB' } }
  };
  const business = {
    prices: { yookassa: { amountMinor: 290_000, currency: 'RUB' } }
  };

  it('gives the same amounts for Date and ISO text instants', () => {
    const fromDates = prorationAmounts({
      fromPlan: pro,
      toPlan: business,
      provider: 'yookassa',
      periodStart: utc(2026, 8, 1),
      periodEnd: utc(2026, 9, 1),
      now: utc(2026, 8, 11)
    });
    const fromText = prorationAmounts({
      fromPlan: pro,
      toPlan: business,
      provider: 'yookassa',
      periodStart: '2026-09-01T00:00:00.000Z',
      periodEnd: '2026-10-01T00:00:00.000Z',
      now: '2026-09-11T00:00:00.000Z'
    });

    expect(fromDates).toEqual({
      remainderDays: 20,
      totalDays: 30,
      currency: 'RUB',
      refundMinor: 66_000,
      chargeMinor: 193_333
    });
    expect(fromText).toEqual(fromDates);
  });
});

describe('rateUsage', () => {
  const price = { includedUnits: 100, unitPriceMinor: 200 };

  it.each([
    [99, 0],
    [100, 0],
    [142, 42]
  ])('bills %i units past the included units as %i', (totalUnits, billable) => {
    expect(rateUsage({ totalUnits, price })).toEqual({
      includedUnits: 100,
      unitPriceMinor: 200,
      billableUnits: billable,
      creditUnitsApplied: 0,
      chargedUnits: billable,
      amountMinor: billable * 200
    });
  });

  it('treats a price without includedUnits and unitPriceMinor as zero values', () => {
    expect(rateUsage({ totalUnits: 10, price: {} })).toMatchObject({
      includedUnits: 0,
      unitPriceMinor: 0,
      billableUnits: 10,
      amountMinor: 0
    });
  });

  it('prices an amount beyond int32 without precision loss', () => {
    // 50_000 units at 50_000 minor each exceed the int32 ceiling 2_147_483_647.
    const rated = rateUsage({
      totalUnits: 50_000,
      price: { includedUnits: 0, unitPriceMinor: 50_000 }
    });
    expect(rated.amountMinor).toBe(2_500_000_000);
  });

  it.each([
    ['partial credits', 10, 10, 32],
    ['credits beyond the billable units', 1000, 42, 0],
    ['zero credits', 0, 0, 42],
    ['a negative balance', -100, 0, 42]
  ])(
    'offsets the billable units with %s',
    (_label, availableCreditUnits, applied, charged) => {
      expect(
        rateUsage({ totalUnits: 142, price, availableCreditUnits })
      ).toMatchObject({
        billableUnits: 42,
        creditUnitsApplied: applied,
        chargedUnits: charged,
        amountMinor: charged * 200
      });
    }
  );

  it('spends no credits on a period with no overage', () => {
    expect(
      rateUsage({ totalUnits: 99, price, availableCreditUnits: 50 })
    ).toMatchObject({
      billableUnits: 0,
      creditUnitsApplied: 0,
      amountMinor: 0
    });
  });
});
