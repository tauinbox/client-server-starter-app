import type {
  DataRegion,
  PeerRegions
} from '../constants/data-region.constants';

/** The answer of `GET /api/v1/config/region`: this cell and the other cells. */
export type RegionConfigResponse = {
  region: DataRegion;
  peers: PeerRegions;
  /**
   * The regions that take new accounts, in the order of `DATA_REGIONS`. The
   * home region is always in the list.
   */
  publicRegions: DataRegion[];
};

/** The answer of `PUT /api/v1/admin/regions/:region`. */
export type RegionStatusResponse = {
  region: DataRegion;
  public: boolean;
};
