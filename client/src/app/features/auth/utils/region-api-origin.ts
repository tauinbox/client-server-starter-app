import { REGIONS, type DataRegion } from '@app/shared/constants';

/**
 * The origin of the API of `region` for the SPA at `location`, or null when
 * that API is on the origin of the SPA. The host is the subdomain of the
 * region in front of the host of the SPA, with the protocol and the port of
 * the SPA, so the API is in the same site and its `SameSite=strict` cookies
 * are sent.
 */
export function regionApiOrigin(
  region: DataRegion,
  { protocol, host }: Pick<Location, 'protocol' | 'host'>
): string | null {
  const { apiSubdomain } = REGIONS[region];

  return apiSubdomain === null ? null : `${protocol}//${apiSubdomain}.${host}`;
}
