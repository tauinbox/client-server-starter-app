import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { ErrorKeys } from '@app/shared/constants';
import {
  REGION_CONFIG_API_V1,
  RegionConfigService
} from './region-config.service';

const OTHER_REGION = ErrorKeys.AUTH.RESIDENCE_OTHER_REGION;

describe('RegionConfigService', () => {
  let service: RegionConfigService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(RegionConfigService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  describe('peerUrl', () => {
    async function peerUrlWith(
      peers: Record<string, string>
    ): Promise<string | null> {
      const result = firstValueFrom(service.peerUrl('RU', OTHER_REGION));

      httpTesting
        .expectOne(REGION_CONFIG_API_V1)
        .flush({ region: 'intl', peers });

      return result;
    }

    it.each([
      ErrorKeys.AUTH.RESIDENCE_REGION_NOT_SERVED,
      ErrorKeys.AUTH.RESIDENCE_ALREADY_DECLARED,
      undefined
    ])('gives null with no request after %s', async (errorKey) => {
      await expect(
        firstValueFrom(service.peerUrl('RU', errorKey))
      ).resolves.toBeNull();
      httpTesting.expectNone(REGION_CONFIG_API_V1);
    });

    it('gives the https URL of the cell that serves the country', async () => {
      await expect(peerUrlWith({ ru: 'https://ru.example.com' })).resolves.toBe(
        'https://ru.example.com'
      );
    });

    it('gives null for a URL that is not https', async () => {
      await expect(peerUrlWith({ ru: 'javascript:alert(1)' })).resolves.toBe(
        null
      );
    });

    it('gives null when no cell serves the region', async () => {
      await expect(peerUrlWith({})).resolves.toBe(null);
    });

    it('gives null when the config does not load', async () => {
      const result = firstValueFrom(service.peerUrl('RU', OTHER_REGION));

      httpTesting
        .expectOne(REGION_CONFIG_API_V1)
        .flush(null, { status: 503, statusText: 'Unavailable' });

      await expect(result).resolves.toBe(null);
    });
  });
});
