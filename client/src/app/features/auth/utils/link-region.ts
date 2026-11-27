import {
  HOME_DATA_REGION,
  isDataRegion,
  type DataRegion
} from '@app/shared/constants';

/**
 * The region that a mailed link names in its `region` query parameter, or
 * null for a value that is not a region of the code. A link with no region
 * is the home region, as a persisted session with no region is.
 */
export function linkRegion(value: unknown): DataRegion | null {
  if (value === undefined) return HOME_DATA_REGION;

  return isDataRegion(value) ? value : null;
}
