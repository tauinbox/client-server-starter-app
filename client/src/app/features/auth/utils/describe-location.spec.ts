import { describeLocation } from './describe-location';

describe('describeLocation', () => {
  it('names the country in the UI language after the city', () => {
    expect(describeLocation('DE', 'Berlin', 'en')).toBe('Berlin, Germany');
    expect(describeLocation('DE', 'Berlin', 'ru')).toBe('Berlin, Германия');
  });

  it('shows the country alone when the city is unknown', () => {
    expect(describeLocation('FR', null, 'en')).toBe('France');
  });

  it('shows the code of a country it cannot name', () => {
    expect(describeLocation('1', null, 'en')).toBe('1');
  });

  it('returns null when nothing is known', () => {
    expect(describeLocation(null, null, 'en')).toBeNull();
  });
});
