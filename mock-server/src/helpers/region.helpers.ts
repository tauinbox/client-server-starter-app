import {
  DATA_REGIONS,
  ErrorKeys,
  HOME_DATA_REGION,
  regionForCountry,
  type CountryCode,
  type ErrorKey
} from '@app/shared/constants';
import type { RegionConfigResponse } from '@app/shared/types';
import { mockRegion } from '../instance';
import { getState } from '../state';

/**
 * Mirrors `GET /config/region` of the server: the region of this instance,
 * its peers and the public regions. An instance has no peers until a test
 * sets them through /__control/region-peers.
 */
export function regionConfig(): RegionConfigResponse {
  const { regionPeers, regionRegistry } = getState();

  return {
    region: mockRegion(),
    peers: regionPeers,
    publicRegions: DATA_REGIONS.filter(
      (region) => region === HOME_DATA_REGION || regionRegistry[region] === true
    )
  };
}

/** Mirrors `RegionService.assertServesCountry`. */
export function residenceRefusal(
  country: CountryCode
): { errorKey: ErrorKey; message: string } | null {
  const region = regionForCountry(country);

  if (region === mockRegion()) return null;

  if (getState().regionPeers[region]) {
    return {
      errorKey: ErrorKeys.AUTH.RESIDENCE_OTHER_REGION,
      message: 'Accounts for this country are kept in another region'
    };
  }

  return {
    errorKey: ErrorKeys.AUTH.RESIDENCE_REGION_NOT_SERVED,
    message: 'Accounts for this country are not available yet'
  };
}
