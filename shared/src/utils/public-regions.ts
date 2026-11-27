import {
  DATA_REGIONS,
  HOME_DATA_REGION,
  type DataRegion
} from '../constants/data-region.constants';

/**
 * The regions that take new accounts, in the order of `DATA_REGIONS`: the
 * home region always, and each other region that the registry opens.
 */
export function publicRegions(
  isOpen: (region: DataRegion) => boolean
): DataRegion[] {
  return DATA_REGIONS.filter(
    (region) => region === HOME_DATA_REGION || isOpen(region)
  );
}
