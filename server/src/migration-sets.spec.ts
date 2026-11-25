import { DATA_REGIONS, HOME_DATA_REGION } from '@app/shared/constants';
import { assertSettingsWriter, dataRegionFromEnv } from './migration-sets';

const OTHER_REGION = DATA_REGIONS.find((region) => region !== HOME_DATA_REGION);

describe('dataRegionFromEnv', () => {
  it('returns a data region', () => {
    expect(dataRegionFromEnv({ DATA_REGION: HOME_DATA_REGION })).toBe(
      HOME_DATA_REGION
    );
  });

  it.each([undefined, '', 'eu'])('refuses %p', (value) => {
    expect(() => dataRegionFromEnv({ DATA_REGION: value })).toThrow(
      'DATA_REGION must be one of the data regions'
    );
  });
});

describe('assertSettingsWriter', () => {
  it('lets the home pool write the settings', () => {
    expect(() =>
      assertSettingsWriter({ DATA_REGION: HOME_DATA_REGION })
    ).not.toThrow();
  });

  it('refuses every other pool', () => {
    expect(() => assertSettingsWriter({ DATA_REGION: OTHER_REGION })).toThrow(
      `Settings are written only on the ${HOME_DATA_REGION} pool; this pool is ${OTHER_REGION}`
    );
  });
});
