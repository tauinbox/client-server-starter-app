import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requiresSecureCookies } from '@app/shared/constants';
import type { NextFunction, Request, Response } from 'express';
import {
  cookieName,
  HOST_COOKIE_PATH,
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
    // The bare name was issued before the `__Host-` prefix. Carrying its value
    // over keeps a returning visitor in the same rollout bucket. Remove this
    // once JWT_REFRESH_EXPIRATION has passed since that change shipped, with
    // the refresh cookie fallback.
    const legacy = secure
      ? readHostCookie(req, ANON_ID_COOKIE, false)
      : undefined;
    if (legacy !== undefined) {
      res.clearCookie(ANON_ID_COOKIE, { secure, path: HOST_COOKIE_PATH });
    }
    const value = legacy ?? randomUUID();
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
