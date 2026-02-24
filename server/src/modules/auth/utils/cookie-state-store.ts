import { randomBytes } from 'crypto';
import type { Request, Response } from 'express';

const COOKIE_NAME = 'oauth_state';
const COOKIE_MAX_AGE_MS = 5 * 60 * 1000;
const COOKIE_PATH = '/api/v1/auth/oauth';

export class CookieStateStore {
  constructor(private readonly isProduction: boolean) {}

  store(
    req: Request & { res?: Response },
    callback: (err: Error | null, state?: string) => void
  ): void {
    const state = randomBytes(32).toString('hex');

    req.res?.cookie(COOKIE_NAME, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isProduction,
      path: COOKIE_PATH,
      maxAge: COOKIE_MAX_AGE_MS
    });

    callback(null, state);
  }

  verify(
    req: Request,
    providedState: string,
    callback: (err: Error | null, ok?: boolean) => void
  ): void {
    const cookieState = (req.cookies as Record<string, string> | undefined)?.[
      COOKIE_NAME
    ];

    (req.res as Response | undefined)?.clearCookie(COOKIE_NAME, {
      path: COOKIE_PATH
    });

    if (!cookieState || cookieState !== providedState) {
      callback(null, false);
      return;
    }

    callback(null, true);
  }
}
