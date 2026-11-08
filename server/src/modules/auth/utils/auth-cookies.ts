import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { requiresSecureCookies } from '@app/shared/constants';
import {
  OAUTH_LINK_COOKIE,
  OAUTH_REAUTH_COOKIE,
  REAUTH_PROOF_COOKIE
} from '../constants/oauth.constants';
import {
  clearHostCookie,
  readHostCookie,
  setHostCookie
} from '../../../common/utils/host-cookie';
import { readIntentForFlow } from './oauth-flow-intent';

const REFRESH_TOKEN_COOKIE = 'refresh_token';

/** The token of each intent cookie that the current flow claimed, else null. */
export interface ClaimedIntents {
  link: string | null;
  reauth: string | null;
}

export type ClaimedFlow =
  | { kind: 'reauth'; token: string }
  | { kind: 'link'; token: string }
  | { kind: 'login' };

/**
 * The flow of one provider request. Re-authentication wins a tie because it
 * links nothing.
 */
export function claimedFlow({ link, reauth }: ClaimedIntents): ClaimedFlow {
  if (reauth !== null) {
    return { kind: 'reauth', token: reauth };
  }

  return link !== null ? { kind: 'link', token: link } : { kind: 'login' };
}

/**
 * The auth cookies, bound to the environment once. Every flag comes from
 * `host-cookie`; this class adds only the `SameSite` value of each cookie:
 * `strict` for the refresh token, `lax` for the cookies that must survive the
 * provider redirect.
 */
@Injectable()
export class AuthCookies {
  constructor(private readonly configService: ConfigService) {}

  get secure(): boolean {
    return requiresSecureCookies(this.configService.get<string>('ENVIRONMENT'));
  }

  /**
   * getOrThrow: a missing value must fail loudly, not silently downgrade the
   * refresh cookie to a session cookie via a NaN maxAge.
   */
  get refreshMaxAge(): number {
    return (
      Number(this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRATION')) *
      1000
    );
  }

  setRefresh(
    res: Response,
    token: string,
    maxAge: number = this.refreshMaxAge
  ): void {
    setHostCookie(
      res,
      { base: REFRESH_TOKEN_COOKIE, value: token, secure: this.secure },
      {
        httpOnly: true,
        sameSite: 'strict',
        maxAge
      }
    );
  }

  clearRefresh(res: Response): void {
    this.clear(res, REFRESH_TOKEN_COOKIE);
  }

  readRefresh(req: Pick<Request, 'cookies'>): string | undefined {
    return this.read(req, REFRESH_TOKEN_COOKIE);
  }

  setShortLived(
    res: Response,
    { base, value }: { base: string; value: string },
    maxAgeSeconds: number
  ): void {
    setHostCookie(
      res,
      { base, value, secure: this.secure },
      {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: maxAgeSeconds * 1000
      }
    );
  }

  read(req: Pick<Request, 'cookies'>, base: string): string | undefined {
    return readHostCookie(req, base, this.secure);
  }

  clear(res: Response, base: string): void {
    clearHostCookie(res, base, this.secure);
  }

  readReauthProof(req: Pick<Request, 'cookies'>): string | undefined {
    return this.read(req, REAUTH_PROOF_COOKIE);
  }

  /**
   * Called only after a change is accepted, so a rejected attempt keeps its
   * remaining proof window. The ledger already refuses a second use of the
   * value; this stops the browser from holding a credential that is spent.
   */
  clearReauthProof(res: Response): void {
    this.clear(res, REAUTH_PROOF_COOKIE);
  }

  /**
   * An intent belongs to the flow that claimed it: the `state` of the callback
   * selects it. An intent of another flow, or one that no flow claimed, gives
   * null, so this callback is a plain sign-in for it.
   */
  claimedIntents(req: Pick<Request, 'cookies' | 'query'>): ClaimedIntents {
    const state: unknown = req.query?.['state'];
    const claim = (base: string): string | null => {
      const intent = this.read(req, base);

      return intent ? readIntentForFlow(intent, state) : null;
    };

    return {
      link: claim(OAUTH_LINK_COOKIE),
      reauth: claim(OAUTH_REAUTH_COOKIE)
    };
  }

  /**
   * An abandoned link or re-authentication attempt must not outlive the
   * session that started it: the callback links whatever identity signs in
   * next.
   */
  clearIntents(res: Response): void {
    this.clear(res, OAUTH_LINK_COOKIE);
    this.clear(res, OAUTH_REAUTH_COOKIE);
    this.clearReauthProof(res);
  }
}
