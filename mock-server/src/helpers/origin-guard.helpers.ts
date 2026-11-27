import type { RequestHandler } from 'express';
import { REGIONS, type DataRegion } from '@app/shared/constants';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Mirrors `RegionService.requiredOrigin` of the server: the origin of the SPA
 * when the API of the region has a host of its own, else null.
 */
export function requiredOriginOf(
  region: DataRegion,
  clientUrl: string | undefined
): string | null {
  if (REGIONS[region].apiSubdomain === null) return null;

  if (!clientUrl) {
    throw new Error('CLIENT_URL environment variable is not configured');
  }

  return new URL(clientUrl).origin;
}

/**
 * Mirrors `OriginGuardMiddleware` of the server (MR-16): a request other than
 * GET, HEAD or OPTIONS passes only with the SPA origin, or with no `Origin`
 * and no cookie (not a browser session, such as a provider webhook).
 */
export function originGuard(requiredOrigin: string): RequestHandler {
  return (req, res, next) => {
    const { origin, cookie } = req.headers;

    if (
      SAFE_METHODS.has(req.method) ||
      origin === requiredOrigin ||
      (origin === undefined && cookie === undefined)
    ) {
      next();

      return;
    }

    // eslint-disable-next-line no-restricted-syntax -- the server sends this refusal with no key
    res.status(403).json({ message: 'Origin not allowed' });
  };
}
