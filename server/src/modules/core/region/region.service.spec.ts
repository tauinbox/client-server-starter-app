import { isolatedConfig } from '../../../common/testing/isolated-config';
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
});
