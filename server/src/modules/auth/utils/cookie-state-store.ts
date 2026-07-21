import { randomBytes, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import type OAuth2Strategy from 'passport-oauth2';

const COOKIE_NAME = 'oauth_state';
const COOKIE_MAX_AGE_MS = 5 * 60 * 1000;
const COOKIE_PATH = '/api/v1/auth/oauth';

/**
 * Compares without leaking how many leading characters matched. The length
 * check runs first because timingSafeEqual throws on differing lengths - the
 * state's length is fixed and not a secret, so revealing it costs nothing.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

export class CookieStateStore implements OAuth2Strategy.StateStore {
  constructor(private readonly isProduction: boolean) {}

  store(req: Request, callback: OAuth2Strategy.StateStoreStoreCallback): void;
  store(
    req: Request,
    meta: OAuth2Strategy.Metadata,
    callback: OAuth2Strategy.StateStoreStoreCallback
  ): void;
  store(
    req: Request,
    callbackOrMeta:
      | OAuth2Strategy.StateStoreStoreCallback
      | OAuth2Strategy.Metadata,
    maybeCallback?: OAuth2Strategy.StateStoreStoreCallback
  ): void {
    const callback =
      typeof callbackOrMeta === 'function' ? callbackOrMeta : maybeCallback!;

    const state = randomBytes(32).toString('hex');

    (req as Request & { res?: Response }).res?.cookie(COOKIE_NAME, state, {
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
    callback: OAuth2Strategy.StateStoreVerifyCallback
  ): void;
  verify(
    req: Request,
    providedState: string,
    meta: OAuth2Strategy.Metadata,
    callback: OAuth2Strategy.StateStoreVerifyCallback
  ): void;
  verify(
    req: Request,
    providedState: string,
    callbackOrMeta:
      | OAuth2Strategy.StateStoreVerifyCallback
      | OAuth2Strategy.Metadata,
    maybeCallback?: OAuth2Strategy.StateStoreVerifyCallback
  ): void {
    const callback =
      typeof callbackOrMeta === 'function' ? callbackOrMeta : maybeCallback!;

    const cookieState = (req.cookies as Record<string, string> | undefined)?.[
      COOKIE_NAME
    ];

    (req.res as Response | undefined)?.clearCookie(COOKIE_NAME, {
      path: COOKIE_PATH
    });

    if (!cookieState || !timingSafeStringEqual(cookieState, providedState)) {
      callback(null, false, providedState);
      return;
    }

    callback(null, true, providedState);
  }
}
