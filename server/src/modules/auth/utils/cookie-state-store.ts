import { randomBytes } from 'crypto';
import type { CookieOptions, Request, Response } from 'express';
import type OAuth2Strategy from 'passport-oauth2';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import {
  OAUTH_INTENT_COOKIE_PATH,
  OAUTH_LINK_COOKIE,
  OAUTH_REAUTH_COOKIE
} from '../constants/oauth.constants';
import { bindIntent, isIntentBound } from './oauth-flow-intent';
import { timingSafeStringEqual } from './timing-safe-equal';

const COOKIE_NAME_PREFIX = 'oauth_state_';
const COOKIE_MAX_AGE_MS = 5 * 60 * 1000;
const COOKIE_PATH = '/api/v1/auth/oauth';

/**
 * Hex states and decimal timestamps never contain these, so they separate the
 * cookie's parts unambiguously and survive cookie encoding untouched. A PKCE
 * verifier is base64url, which can contain `-` and never `.`, so it is the last
 * field of an entry and is read as the remainder.
 */
const ENTRY_SEPARATOR = '.';
const FIELD_SEPARATOR = '-';

/**
 * Every tab appends its own state, so the cap bounds both the cookie size and
 * the number of flows one provider can have in flight at the same time.
 */
const MAX_PENDING_STATES = 5;

/**
 * A later flow refreshes the cookie's own maxAge, which would otherwise extend
 * every state already in it. Each entry therefore carries its own deadline.
 */
interface PendingState {
  state: string;
  expiresAt: number;
  verifier?: string;
}

/**
 * passport-oauth2 sends a string that `verify` reports as `code_verifier` in
 * the token exchange (strategy.js), and its own PKCE store reports one
 * (state/pkcesession.js). The published typings allow a boolean only.
 */
type PkceVerifyCallback = (
  err: Error | null,
  ok: boolean | string,
  state: unknown
) => void;

function isStoreCallback(
  value: unknown
): value is OAuth2Strategy.StateStoreStoreCallback {
  return typeof value === 'function';
}

function serialize(pending: PendingState[]): string {
  return pending
    .map((entry) =>
      [entry.state, entry.expiresAt, entry.verifier]
        .filter((field) => field !== undefined)
        .join(FIELD_SEPARATOR)
    )
    .join(ENTRY_SEPARATOR);
}

export class CookieStateStore implements OAuth2Strategy.StateStore {
  private readonly cookieName: string;

  constructor(
    provider: OAuthProvider,
    private readonly secureCookies: boolean
  ) {
    this.cookieName = `${COOKIE_NAME_PREFIX}${provider}`;
  }

  store(req: Request, callback: OAuth2Strategy.StateStoreStoreCallback): void;
  store(
    req: Request,
    meta: OAuth2Strategy.Metadata,
    callback: OAuth2Strategy.StateStoreStoreCallback
  ): void;
  store(
    req: Request,
    verifier: string | undefined,
    state: unknown,
    meta: OAuth2Strategy.Metadata,
    callback: OAuth2Strategy.StateStoreStoreCallback
  ): void;
  // passport-oauth2 dispatches on `store.length`, and only the five-argument
  // form hands over the PKCE verifier, so all five parameters stay declared.
  store(
    req: Request,
    verifierOrMetaOrCallback: unknown,
    stateOrCallback?: unknown,
    _meta?: OAuth2Strategy.Metadata,
    pkceCallback?: OAuth2Strategy.StateStoreStoreCallback
  ): void {
    const callback = [
      pkceCallback,
      stateOrCallback,
      verifierOrMetaOrCallback
    ].find(isStoreCallback)!;
    const verifier =
      typeof verifierOrMetaOrCallback === 'string'
        ? verifierOrMetaOrCallback
        : undefined;

    const res = (req as Request & { res?: Response }).res;
    if (!res) {
      // Without a response the state is never persisted and the callback would
      // fail verification later with nothing pointing back here.
      callback(
        new Error(
          'Cannot persist the OAuth state cookie: the request has no response object'
        ),
        undefined
      );
      return;
    }

    const state = randomBytes(32).toString('hex');
    const pending = [
      ...this.readPendingStates(req),
      { state, expiresAt: Date.now() + COOKIE_MAX_AGE_MS, verifier }
    ].slice(-MAX_PENDING_STATES);

    res.cookie(this.cookieName, serialize(pending), this.cookieOptions());
    this.bindPendingIntents(req, res, state);

    callback(null, state);
  }

  /**
   * Reports the matched entry's PKCE verifier in place of `true`, which makes
   * passport-oauth2 send it as `code_verifier`. An entry written before PKCE
   * was on has none, and its flow sent no challenge, so `true` is correct.
   */
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
      OAuth2Strategy.StateStoreVerifyCallback | OAuth2Strategy.Metadata,
    maybeCallback?: OAuth2Strategy.StateStoreVerifyCallback
  ): void {
    const callback =
      typeof callbackOrMeta === 'function' ? callbackOrMeta : maybeCallback!;

    if (typeof providedState !== 'string' || providedState.length === 0) {
      callback(null, false, providedState);
      return;
    }

    const pending = this.readPendingStates(req);
    const matched = pending.find((candidate) =>
      timingSafeStringEqual(candidate.state, providedState)
    );

    if (!matched) {
      // Leave the other tabs' states alone: an unmatched callback must not be
      // able to cancel flows it does not own.
      callback(null, false, providedState);
      return;
    }

    const remaining = pending.filter((candidate) => candidate !== matched);
    const res = req.res as Response | undefined;
    if (remaining.length > 0) {
      res?.cookie(this.cookieName, serialize(remaining), this.cookieOptions());
    } else {
      res?.clearCookie(this.cookieName, { path: COOKIE_PATH });
    }

    const report = callback as PkceVerifyCallback;
    report(null, matched.verifier ?? true, providedState);
  }

  /**
   * An intent is a browser-wide cookie, so every callback that finds one takes
   * that branch, whatever request started the callback. Tying an intent to the
   * state this flow just minted makes it apply to this flow alone.
   *
   * Both intents get the same treatment. The link intent attaches a provider
   * identity to an account; the re-authentication intent mints a step-up proof
   * for one. An abandoned intent of either kind must not be picked up by the
   * next flow at that browser.
   *
   * An intent that an earlier flow already claimed is left untouched: handing it
   * to the flow that runs now is the defect itself in a new place. The rewrite
   * refreshes the cookie's own maxAge, which extends nothing in practice - the
   * token inside it carries its own expiry, and the callback still verifies
   * that.
   */
  private bindPendingIntents(req: Request, res: Response, state: string): void {
    const cookies = req.cookies as Record<string, string> | undefined;

    for (const name of [OAUTH_LINK_COOKIE, OAUTH_REAUTH_COOKIE]) {
      const intent = cookies?.[name];
      if (!intent || isIntentBound(intent)) {
        continue;
      }

      res.cookie(name, bindIntent(intent, state), {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.secureCookies,
        path: OAUTH_INTENT_COOKIE_PATH,
        maxAge: COOKIE_MAX_AGE_MS
      });
    }
  }

  private readPendingStates(req: Request): PendingState[] {
    const raw = (req.cookies as Record<string, string> | undefined)?.[
      this.cookieName
    ];
    if (!raw) {
      return [];
    }

    const now = Date.now();

    return raw
      .split(ENTRY_SEPARATOR)
      .map((entry) => {
        const [state, expiresAt, ...verifierParts] =
          entry.split(FIELD_SEPARATOR);
        const verifier = verifierParts.join(FIELD_SEPARATOR) || undefined;
        return { state, expiresAt: Number(expiresAt), verifier };
      })
      .filter(
        (entry) =>
          entry.state?.length > 0 &&
          Number.isFinite(entry.expiresAt) &&
          entry.expiresAt > now
      );
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.secureCookies,
      path: COOKIE_PATH,
      maxAge: COOKIE_MAX_AGE_MS
    };
  }
}
