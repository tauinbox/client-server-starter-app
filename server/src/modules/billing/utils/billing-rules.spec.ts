import { ErrorKeys } from '@app/shared/constants';
import type { CancelMode, SubscriptionStatus } from '@app/shared/types';
import {
  ALREADY_CANCELED,
  billingGeo,
  calendarMonthUtc,
  cancelRefusal,
  crossesZero,
  effectiveProviderId,
  entitlementsOfPlan,
  geoDefault,
  isSameUsage,
  geoFromLocale,
  overrideForRegion,
  prorationAmounts,
  regionForOverride,
  renewalAnchor
} from '@app/shared/utils/billing-rules';

function utc(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

describe('effectiveProviderId', () => {
  it('takes the override first, then the geo default', () => {
    expect(
      effectiveProviderId({ providerOverride: 'paddle', country: 'RU' })
    ).toBe('paddle');
    expect(effectiveProviderId({ providerOverride: null, country: 'ru' })).toBe(
      'yookassa'
    );
  });
});

describe('entitlementsOfPlan', () => {
  it('maps the plan and reads absent limits as none', () => {
    expect(
      entitlementsOfPlan({
        key: 'pro',
        entitlements: ['reports'],
        limits: null
      })
    ).toEqual({ planKey: 'pro', capabilities: ['reports'], limits: {} });
  });
});

describe('cancelRefusal', () => {
  const sub = (
    status: SubscriptionStatus,
    cancelAtPeriodEnd = false
  ): { status: SubscriptionStatus; cancelAtPeriodEnd: boolean } => ({
    status,
    cancelAtPeriodEnd
  });

  it.each<[SubscriptionStatus, boolean, CancelMode, string | null]>([
    ['canceled', false, 'immediate', ALREADY_CANCELED.errorKey],
    ['canceled', false, 'period_end', ALREADY_CANCELED.errorKey],
    ['incomplete', false, 'immediate', null],
    ['incomplete', false, 'period_end', ErrorKeys.BILLING.NO_PAID_PERIOD],
    ['active', true, 'immediate', null],
    [
      'active',
      true,
      'period_end',
      ErrorKeys.BILLING.CANCELLATION_ALREADY_SCHEDULED
    ],
    ['active', false, 'period_end', null]
  ])('%s (scheduled %s), %s -> %s', (status, scheduled, mode, key) => {
    expect(cancelRefusal(sub(status, scheduled), mode)?.errorKey ?? null).toBe(
      key
    );
  });
});

describe('crossesZero', () => {
  it.each([
    [{ before: 0, after: 500 }, true],
    [{ before: 1, after: 0 }, true],
    [{ before: 100, after: -400 }, true],
    [{ before: -50, after: 450 }, true],
    [{ before: 10, after: 5 }, false],
    [{ before: -50, after: -10 }, false],
    [{ before: 0, after: 0 }, false]
  ])('%o crosses zero: %s', (change, expected) => {
    expect(crossesZero(change)).toBe(expected);
  });
});

describe('calendarMonthUtc', () => {
  it('starts on the first day of the month and ends on the first day of the next', () => {
    expect(calendarMonthUtc(new Date('2026-11-17T10:00:00Z'))).toEqual({
      periodStart: utc(2026, 10, 1),
      periodEnd: utc(2026, 11, 1)
    });
  });

  it('ends December on 1 January of the next year', () => {
    expect(calendarMonthUtc(new Date('2026-12-31T23:59:59.999Z'))).toEqual({
      periodStart: utc(2026, 11, 1),
      periodEnd: utc(2027, 0, 1)
    });
  });

  it('reads the month in UTC, not in the local zone', () => {
    expect(
      calendarMonthUtc(new Date('2026-12-01T00:30:00+03:00')).periodStart
    ).toEqual(utc(2026, 10, 1));
  });
});

describe('isSameUsage', () => {
  const stored = {
    meterKey: 'reports.export',
    units: 5,
    occurredAt: new Date('2026-11-17T10:00:00Z')
  };

  it('accepts the same body, with the time as ISO text or as a Date', () => {
    expect(
      isSameUsage(stored, { ...stored, occurredAt: '2026-11-17T10:00:00.000Z' })
    ).toBe(true);
    expect(
      isSameUsage(
        { ...stored, occurredAt: '2026-11-17T10:00:00.000Z' },
        { ...stored, occurredAt: new Date('2026-11-17T13:00:00+03:00') }
      )
    ).toBe(true);
  });

  it('does not compare the time when the request omits it', () => {
    expect(isSameUsage(stored, { meterKey: 'reports.export', units: 5 })).toBe(
      true
    );
  });

  it.each([
    ['another meter', { ...stored, meterKey: 'other.meter' }],
    ['another quantity', { ...stored, units: 6 }],
    ['another time', { ...stored, occurredAt: '2026-11-17T10:00:00.001Z' }]
  ])('refuses %s', (_case, request) => {
    expect(isSameUsage(stored, request)).toBe(false);
  });
});

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

describe('billingGeo', () => {
  it('takes the declared residence over the locale', () => {
    expect(billingGeo({ residenceCountry: 'DE', locale: 'ru' })).toEqual({
      country: 'DE',
      currency: 'USD'
    });
    expect(billingGeo({ residenceCountry: 'RU', locale: 'en' })).toEqual({
      country: 'RU',
      currency: 'RUB'
    });
  });

  it('falls back to the locale when no residence is declared', () => {
    expect(billingGeo({ residenceCountry: null, locale: 'ru-RU' })).toEqual({
      country: 'RU',
      currency: 'RUB'
    });
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
