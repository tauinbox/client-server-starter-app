import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

export const ANON_ID_COOKIE = 'nxs_anon_id';
const COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class AnonIdMiddleware implements NestMiddleware {
  constructor(private readonly configService: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const cookies = (req.cookies ?? {}) as Record<string, unknown>;
    const existing = cookies[ANON_ID_COOKIE];
    if (typeof existing === 'string' && existing !== '') {
      next();
      return;
    }
    const value = randomUUID();
    const isProduction =
      this.configService.get<string>('ENVIRONMENT') === 'production';
    res.cookie(ANON_ID_COOKIE, value, {
      // Bucketing is resolved server-side from the cookie, so no browser script
      // needs to read it.
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/'
    });
    cookies[ANON_ID_COOKIE] = value;
    req.cookies = cookies;
    next();
  }
}
