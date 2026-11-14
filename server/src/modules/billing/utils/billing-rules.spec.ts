import {
  geoDefault,
  geoFromLocale,
  overrideForRegion,
  prorationAmounts,
  regionForOverride,
  renewalAnchor
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
