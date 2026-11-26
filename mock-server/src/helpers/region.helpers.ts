import {
  ErrorKeys,
  HOME_DATA_REGION,
  regionForCountry,
  type CountryCode,
  type DataRegion,
  type ErrorKey
} from '@app/shared/constants';
import type { RegionConfigResponse } from '@app/shared/types';
import { getState } from '../state';

// The mock is one cell of the home region, as production. It has no peers
// until a test sets them through /__control/region-peers.
export const MOCK_DATA_REGION: DataRegion = HOME_DATA_REGION;

/** Mirrors `RegionService` of the server: this cell and its peers. */
export function regionConfig(): RegionConfigResponse {
  return { region: MOCK_DATA_REGION, peers: getState().regionPeers };
}

/** Mirrors `RegionService.assertServesCountry`. */
export function residenceRefusal(
  country: CountryCode
): { errorKey: ErrorKey; message: string } | null {
  const region = regionForCountry(country);

  if (region === MOCK_DATA_REGION) return null;

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
