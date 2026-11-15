import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataRegion, PeerRegions } from '@app/shared/constants';
import type { RegionConfigResponse } from '@app/shared/types';

/** The data region of this cell and the public URLs of the other cells. */
@Injectable()
export class RegionService {
  readonly region: DataRegion;
  readonly peers: PeerRegions;

  constructor(configService: ConfigService) {
    this.region = configService.getOrThrow<DataRegion>('DATA_REGION');
    this.peers = configService.get<PeerRegions>('PEER_REGIONS') ?? {};
  }

  config(): RegionConfigResponse {
    return { region: this.region, peers: { ...this.peers } };
  }
}
