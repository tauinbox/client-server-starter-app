import { countryName, formatUtcDay } from '@app/shared/utils/intl-format';

describe('countryName', () => {
  it('names the country in the locale', () => {
    expect(countryName('DE', 'en')).toBe('Germany');
    expect(countryName('DE', 'ru')).toBe('Германия');
  });

  it('returns a malformed code as it came, with no throw', () => {
    expect(countryName('1', 'en')).toBe('1');
  });
});

describe('formatUtcDay', () => {
  it('formats the calendar day in UTC, not in the local zone', () => {
    expect(formatUtcDay('2026-03-31T23:30:00.000Z', 'en-GB')).toBe(
      '31 March 2026'
    );
  });
});
