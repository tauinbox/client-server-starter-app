import {
  DATA_REGIONS,
  REGION_INTEGRATIONS,
  REGIONS,
  integrationRegions,
  regionForCountry
} from '@app/shared/constants';

describe('region constants', () => {
  it('lists each region once, in the order of REGIONS', () => {
    expect(DATA_REGIONS).toEqual(['intl', 'ru']);
  });

  it.each([
    ['RU', 'ru'],
    ['DE', 'intl'],
    ['US', 'intl'],
    ['KZ', 'intl']
  ] as const)('keeps a resident of %s in %s', (country, region) => {
    expect(regionForCountry(country)).toBe(region);
  });

  it('gives each integration the regions that list it', () => {
    expect(
      Object.fromEntries(
        REGION_INTEGRATIONS.map((integration) => [
          integration,
          integrationRegions(integration)
        ])
      )
    ).toEqual({
      paddle: ['intl'],
      yookassa: ['ru'],
      turnstile: ['intl'],
      googleOAuth: ['intl'],
      facebookOAuth: ['intl'],
      vkOAuth: ['intl', 'ru']
    });
  });

  it('keeps the mail of the ru region in Russia', () => {
    expect(REGIONS.ru.smtpProviderRegions).toEqual(['ru']);
    expect(REGIONS.intl.smtpProviderRegions).toEqual(['intl', 'ru']);
  });
});
