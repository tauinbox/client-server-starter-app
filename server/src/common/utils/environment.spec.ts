import { APP_ENVIRONMENTS, requiresSecureCookies } from '@app/shared/constants';

describe('requiresSecureCookies', () => {
  it('is false only for local, the one environment served over plain HTTP', () => {
    expect(requiresSecureCookies('local')).toBe(false);
  });

  // Regression: the sites this helper replaced compared against 'production'
  // alone, so a staging or development deployment sent its refresh token
  // without Secure.
  it('is true for every other accepted environment', () => {
    const others = APP_ENVIRONMENTS.filter((name) => name !== 'local');
    expect(others).toEqual(['development', 'staging', 'production']);
    for (const name of others) {
      expect(requiresSecureCookies(name)).toBe(true);
    }
  });

  it('is true for a missing or unknown value, so a typo fails secure', () => {
    expect(requiresSecureCookies(undefined)).toBe(true);
    expect(requiresSecureCookies('')).toBe(true);
    expect(requiresSecureCookies('prod')).toBe(true);
  });
});
