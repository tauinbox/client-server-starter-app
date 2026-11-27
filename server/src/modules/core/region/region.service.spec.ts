import { ErrorKeys } from '@app/shared/constants';
import { isolatedConfig } from '../../../common/testing/isolated-config';
import { thrownBy } from '../../../common/testing/thrown-by';
import { expectApiError } from '../../../common/testing/api-error.expect';
import { RegionService } from './region.service';

describe('RegionService', () => {
  it('answers the region of the cell and its peers', () => {
    const service = new RegionService(
      isolatedConfig({
        DATA_REGION: 'intl',
        PEER_REGIONS: { ru: 'https://ru.example.com' }
      })
    );

    expect(service.config()).toEqual({
      region: 'intl',
      peers: { ru: 'https://ru.example.com' }
    });
  });

  it('answers no peers when PEER_REGIONS is unset', () => {
    const service = new RegionService(isolatedConfig({ DATA_REGION: 'intl' }));

    expect(service.config()).toEqual({ region: 'intl', peers: {} });
  });

  it('refuses to start without DATA_REGION', () => {
    expect(() => new RegionService(isolatedConfig())).toThrow('DATA_REGION');
  });

  describe('requiredOrigin', () => {
    it('is null when the API of the region is on the origin of the SPA', () => {
      const service = new RegionService(
        isolatedConfig({ DATA_REGION: 'intl' })
      );

      expect(service.requiredOrigin).toBeNull();
    });

    it('is the origin of CLIENT_URL when the region has an API host of its own', () => {
      const service = new RegionService(
        isolatedConfig({
          DATA_REGION: 'ru',
          CLIENT_URL: 'https://app.example.com/some/path'
        })
      );

      expect(service.requiredOrigin).toBe('https://app.example.com');
    });

    it('refuses to start a pool with an API host of its own without CLIENT_URL', () => {
      expect(
        () => new RegionService(isolatedConfig({ DATA_REGION: 'ru' }))
      ).toThrow('CLIENT_URL');
    });
  });

  describe('assertServesCountry', () => {
    const intl = (peers?: Record<string, string>) =>
      new RegionService(
        isolatedConfig({ DATA_REGION: 'intl', PEER_REGIONS: peers })
      );

    it('accepts a country of its own region', () => {
      expect(() => intl().assertServesCountry('DE')).not.toThrow();
    });

    it('sends a resident of a served peer region to that region', () => {
      expectApiError(
        thrownBy(() =>
          intl({ ru: 'https://ru.example.com' }).assertServesCountry('RU')
        ),
        ErrorKeys.AUTH.RESIDENCE_OTHER_REGION
      );
    });

    it('answers that a region with no peer is not served yet', () => {
      expectApiError(
        thrownBy(() => intl().assertServesCountry('RU')),
        ErrorKeys.AUTH.RESIDENCE_REGION_NOT_SERVED
      );
    });

    it('refuses a country of another region in a ru cell', () => {
      const ru = new RegionService(
        isolatedConfig({
          DATA_REGION: 'ru',
          CLIENT_URL: 'https://app.example.com',
          PEER_REGIONS: { intl: 'https://app.example.com' }
        })
      );

      expect(() => ru.assertServesCountry('RU')).not.toThrow();
      expectApiError(
        thrownBy(() => ru.assertServesCountry('US')),
        ErrorKeys.AUTH.RESIDENCE_OTHER_REGION
      );
    });
  });
});
