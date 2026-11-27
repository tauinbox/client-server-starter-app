import type { NestMiddleware } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { RegionService } from '../region/region.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * On an API host that is not the origin of the SPA, `SameSite=strict` also
 * sends the cookies of the host from every other subdomain of the site, and
 * CORS limits only the read of the answer. Thus a request that can change
 * state must come from the SPA (MR-16). A request with no `Origin` and no
 * cookie is not from a browser session (a provider webhook) and passes. A
 * browser of the Fetch standard sends `Origin` on every such request; Firefox
 * before 70 and Edge before 79 sent none on a POST, so a cookie with no
 * `Origin` is refused.
 */
@Injectable()
export class OriginGuardMiddleware implements NestMiddleware {
  constructor(private readonly region: RegionService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const { requiredOrigin } = this.region;
    const { origin, cookie } = req.headers;

    if (
      requiredOrigin === null ||
      SAFE_METHODS.has(req.method) ||
      origin === requiredOrigin ||
      (origin === undefined && cookie === undefined)
    ) {
      next();

      return;
    }

    // eslint-disable-next-line no-restricted-syntax -- no SPA user sees it: CORS hides the answer from the page of another origin
    throw new ForbiddenException('Origin not allowed');
  }
}
