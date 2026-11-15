import type {
  DataRegion,
  PeerRegions
} from '../constants/data-region.constants';

/** The answer of `GET /api/v1/config/region`: this cell and the other cells. */
export type RegionConfigResponse = {
  region: DataRegion;
  peers: PeerRegions;
};
