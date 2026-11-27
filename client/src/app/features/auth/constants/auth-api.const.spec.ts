import { DATA_REGIONS, HOME_DATA_REGION, REGIONS } from '@app/shared/constants';
import { oauthStartUrl } from './auth-api.const';

const location = { protocol: 'https:', host: 'app.example.com' };

describe('oauthStartUrl', () => {
  it('keeps the start of the home region on the origin of the SPA', () => {
    expect(
      oauthStartUrl('google', { region: HOME_DATA_REGION, location })
    ).toBe('/api/v1/auth/oauth/google');
  });

  it('puts the API host of each other region in front of the start', () => {
    const others = DATA_REGIONS.filter(
      (region) => REGIONS[region].apiSubdomain !== null
    );

    expect(others.length).toBeGreaterThan(0);

    for (const region of others) {
      expect(oauthStartUrl('vk', { region, location })).toBe(
        `https://${REGIONS[region].apiSubdomain}.app.example.com/api/v1/auth/oauth/vk`
      );
    }
  });
});
