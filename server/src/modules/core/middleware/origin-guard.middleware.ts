import type { NestMiddleware } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { RegionService } from '../region/region.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * On an API host that is not the origin of the SPA, `SameSite=strict` also
 * sends the cookies of the host from every other subdomain of the site, and
 * CORS limits only the read of the answer. Thus a request that can change
 * state must come from the SPA (MR-16). A browser sends `Origin` on every
 * such request, so a request with no `Origin` is not from a browser (a
 * provider webhook) and carries no cookie of a user.
 */
@Injectable()
export class OriginGuardMiddleware implements NestMiddleware {
  constructor(private readonly region: RegionService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const { requiredOrigin } = this.region;
    const { origin } = req.headers;

    if (
      requiredOrigin === null ||
      SAFE_METHODS.has(req.method) ||
      origin === undefined ||
      origin === requiredOrigin
    ) {
      next();

      return;
    }

    // eslint-disable-next-line no-restricted-syntax -- no SPA user sees it: CORS hides the answer from the page of another origin
    throw new ForbiddenException('Origin not allowed');
  }
}
