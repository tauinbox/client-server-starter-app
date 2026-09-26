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
  readHostCookie
} from '../../../common/utils/host-cookie';
import {
  clearRefreshTokenCookie,
  readRefreshTokenCookie,
  setRefreshTokenCookie
} from './refresh-token-cookie';

/**
 * The cookies the auth controllers share, bound to the environment once. It
 * adds no cookie rule of its own: every flag comes from `host-cookie` and
 * `refresh-token-cookie`, so one route cannot drift from the others.
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
    setRefreshTokenCookie(res, token, maxAge, this.secure);
  }

  clearRefresh(res: Response): void {
    clearRefreshTokenCookie(res, this.secure);
  }

  readRefresh(req: Pick<Request, 'cookies'>): string | undefined {
    return readRefreshTokenCookie(req, this.secure);
  }

  readReauthProof(req: Pick<Request, 'cookies'>): string | undefined {
    return readHostCookie(req, REAUTH_PROOF_COOKIE, this.secure);
  }

  /**
   * Called only after a change is accepted, so a rejected attempt keeps its
   * remaining proof window. The ledger already refuses a second use of the
   * value; this stops the browser from holding a credential that is spent.
   */
  clearReauthProof(res: Response): void {
    clearHostCookie(res, REAUTH_PROOF_COOKIE, this.secure);
  }

  /**
   * An abandoned link or re-authentication attempt must not outlive the
   * session that started it: the callback links whatever identity signs in
   * next.
   */
  clearIntents(res: Response): void {
    clearHostCookie(res, OAUTH_LINK_COOKIE, this.secure);
    clearHostCookie(res, OAUTH_REAUTH_COOKIE, this.secure);
    this.clearReauthProof(res);
  }
}
