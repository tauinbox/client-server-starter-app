import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ErrorKeys,
  REGIONS,
  regionForCountry,
  writesSettings,
  type CountryCode,
  type DataRegion,
  type PeerRegions
} from '@app/shared/constants';
import type { RegionConfigResponse } from '@app/shared/types';
import { ApiError } from '../../../common/errors/api-error';
import { validateClientUrl } from '../../auth/providers/client-url.provider';

/** The data region of this cell and the public URLs of the other cells. */
@Injectable()
export class RegionService {
  readonly region: DataRegion;
  readonly peers: PeerRegions;
  /**
   * True on the pool of the settings primary. A settings write that no
   * request makes (the resource sync, the log retention) runs only there.
   */
  readonly writesSettings: boolean;
  /**
   * The one `Origin` that a request other than GET, HEAD or OPTIONS may carry,
   * when the API of this pool has a host of its own (MR-16); null when the
   * API is on the origin of the SPA.
   */
  readonly requiredOrigin: string | null;

  constructor(configService: ConfigService) {
    this.region = configService.getOrThrow<DataRegion>('DATA_REGION');
    this.peers = configService.get<PeerRegions>('PEER_REGIONS') ?? {};
    this.writesSettings = writesSettings(this.region);
    this.requiredOrigin =
      REGIONS[this.region].apiSubdomain === null
        ? null
        : new URL(validateClientUrl(configService.get<string>('CLIENT_URL')))
            .origin;
  }

  config(): RegionConfigResponse {
    return { region: this.region, peers: { ...this.peers } };
  }

  /**
   * Refuses a resident of a country whose personal data this cell may not
   * hold. The client reads the URL of the peer from `config()`.
   */
  assertServesCountry(country: CountryCode): void {
    const region = regionForCountry(country);

    if (region === this.region) return;

    if (this.peers[region]) {
      throw new ApiError(
        ErrorKeys.AUTH.RESIDENCE_OTHER_REGION,
        'Accounts for this country are kept in another region'
      );
    }

    throw new ApiError(
      ErrorKeys.AUTH.RESIDENCE_REGION_NOT_SERVED,
      'Accounts for this country are not available yet'
    );
  }
}
