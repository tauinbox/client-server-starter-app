import {
  ErrorKeys,
  regionForCountry,
  type CountryCode,
  type ErrorKey
} from '@app/shared/constants';
import type { RegionConfigResponse } from '@app/shared/types';

// The mock is one cell of the `intl` region with no peers, as production.
export const MOCK_REGION_CONFIG: RegionConfigResponse = {
  region: 'intl',
  peers: {}
};

/** Mirrors `RegionService.assertServesCountry`. */
export function residenceRefusal(
  country: CountryCode
): { errorKey: ErrorKey; message: string } | null {
  const region = regionForCountry(country);

  if (region === MOCK_REGION_CONFIG.region) return null;

  if (MOCK_REGION_CONFIG.peers[region]) {
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
