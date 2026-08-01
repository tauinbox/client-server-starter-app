import type { ExecutionContext, Type } from '@nestjs/common';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { IAuthGuard } from '@nestjs/passport';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom, isObservable } from 'rxjs';
import type { Request as ExpressRequest } from 'express';
import type { OAuthFailureRedirect } from '../exceptions/oauth-authentication-failed.exception';
import {
  OAUTH_ERROR_AUTH_FAILED,
  OAUTH_ERROR_CANCELLED,
  OAuthAuthenticationFailedException
} from '../exceptions/oauth-authentication-failed.exception';
import { OAUTH_LINK_COOKIE } from '../constants/oauth.constants';

// Passport rejects with this message only when the provider's credentials
// are absent and conditionalProvider skipped registering the strategy.
const MISSING_STRATEGY_MESSAGE = 'Unknown authentication strategy';

// Every provider reports a declined consent screen this way (RFC 6749 4.1.2.1),
// and passport-oauth2 turns it into a plain fail() indistinguishable from an
// expired state cookie - so the intent has to be read off the request.
const PROVIDER_CANCELLED_ERROR = 'access_denied';

export function createOAuthProviderGuard(
  strategy: string,
  providerName: string
): Type<IAuthGuard> {
  @Injectable()
  class OAuthProviderGuard extends AuthGuard(strategy) {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      try {
        const result = super.canActivate(context);
        if (isObservable(result)) return firstValueFrom(result);
        return await result;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith(MISSING_STRATEGY_MESSAGE)
        ) {
          throw new NotFoundException(
            `${providerName} OAuth is not configured`
          );
        }
        throw error;
      }
    }

    /**
     * The base guard answers a Passport failure with UnauthorizedException, so
     * a denied consent screen, an expired state cookie or a failed code
     * exchange leaves the browser on the API origin looking at a JSON 401 -
     * the callback handler that redirects back to the client is never reached.
     * Throwing here instead lets OAuthAuthenticationExceptionFilter send the
     * user back to the client - to the profile page when the failure ends a
     * link attempt started there. Passport only invokes this hook on
     * success/fail/error, never on the initiation redirect, so both routes of
     * a provider can share it.
     */
    handleRequest<TUser = unknown>(
      err: unknown,
      user: unknown,
      _info: unknown,
      context: ExecutionContext,
      _status?: unknown
    ): TUser {
      if (err || !user) {
        const request = context.switchToHttp().getRequest<ExpressRequest>();
        throw new OAuthAuthenticationFailedException(
          resolveErrorKey(request),
          err,
          resolveRedirectPath(request)
        );
      }
      return user as TUser;
    }
  }
  return OAuthProviderGuard;
}

function resolveErrorKey(request: ExpressRequest): string {
  return request.query?.['error'] === PROVIDER_CANCELLED_ERROR
    ? OAUTH_ERROR_CANCELLED
    : OAUTH_ERROR_AUTH_FAILED;
}

function resolveRedirectPath(request: ExpressRequest): OAuthFailureRedirect {
  const cookies = request.cookies as Record<string, string> | undefined;
  return cookies?.[OAUTH_LINK_COOKIE] ? '/profile' : '/login';
}
