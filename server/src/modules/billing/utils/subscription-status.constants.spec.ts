import {
  CHANGEABLE_SUBSCRIPTION_STATUSES,
  ENTITLED_SUBSCRIPTION_STATUSES,
  OPEN_SUBSCRIPTION_STATUSES,
  isOpenStatus
} from '@app/shared/constants';

/**
 * Membership guard for the shared status sets. These sets decide who is billed,
 * who keeps entitlements and which subscription a cancel addresses, and every
 * consumer in the server and the mock now reads them from one file — so a
 * widening has to be a deliberate, reviewed edit here, not a silent one there.
 */
describe('subscription status sets', () => {
  it('ENTITLED_SUBSCRIPTION_STATUSES holds exactly trialing, active, past_due', () => {
    expect([...ENTITLED_SUBSCRIPTION_STATUSES].sort()).toEqual([
      'active',
      'past_due',
      'trialing'
    ]);
  });

  it('OPEN_SUBSCRIPTION_STATUSES holds exactly the non-canceled statuses', () => {
    expect([...OPEN_SUBSCRIPTION_STATUSES].sort()).toEqual([
      'active',
      'incomplete',
      'past_due',
      'trialing'
    ]);
  });

  it('CHANGEABLE_SUBSCRIPTION_STATUSES holds exactly trialing, active', () => {
    expect([...CHANGEABLE_SUBSCRIPTION_STATUSES].sort()).toEqual([
      'active',
      'trialing'
    ]);
  });

  it('excludes canceled from every set', () => {
    expect(ENTITLED_SUBSCRIPTION_STATUSES).not.toContain('canceled');
    expect(OPEN_SUBSCRIPTION_STATUSES).not.toContain('canceled');
    expect(CHANGEABLE_SUBSCRIPTION_STATUSES).not.toContain('canceled');
  });

  it('nests changeable in entitled in open', () => {
    expect(
      CHANGEABLE_SUBSCRIPTION_STATUSES.every((s) =>
        ENTITLED_SUBSCRIPTION_STATUSES.includes(s)
      )
    ).toBe(true);
    expect(
      ENTITLED_SUBSCRIPTION_STATUSES.every((s) =>
        OPEN_SUBSCRIPTION_STATUSES.includes(s)
      )
    ).toBe(true);
  });

  it('isOpenStatus agrees with the open set', () => {
    expect(isOpenStatus('incomplete')).toBe(true);
    expect(isOpenStatus('trialing')).toBe(true);
    expect(isOpenStatus('active')).toBe(true);
    expect(isOpenStatus('past_due')).toBe(true);
    expect(isOpenStatus('canceled')).toBe(false);
  });
});
