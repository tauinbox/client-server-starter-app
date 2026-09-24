import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requiresSecureCookies } from '@app/shared/constants';
import type { NextFunction, Request, Response } from 'express';
import {
  cookieName,
  readHostCookie,
  setHostCookie
} from '../../../common/utils/host-cookie';

export const ANON_ID_COOKIE = 'nxs_anon_id';
const COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class AnonIdMiddleware implements NestMiddleware {
  constructor(private readonly configService: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const secure = requiresSecureCookies(
      this.configService.get<string>('ENVIRONMENT')
    );
    if (readHostCookie(req, ANON_ID_COOKIE, secure) !== undefined) {
      next();
      return;
    }
    const value = randomUUID();
    setHostCookie(res, ANON_ID_COOKIE, value, secure, {
      // Bucketing is resolved server-side from the cookie, so no browser script
      // needs to read it.
      httpOnly: true,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_MS
    });
    const cookies = (req.cookies ?? {}) as Record<string, unknown>;
    cookies[cookieName(ANON_ID_COOKIE, secure)] = value;
    req.cookies = cookies;
    next();
  }
}
