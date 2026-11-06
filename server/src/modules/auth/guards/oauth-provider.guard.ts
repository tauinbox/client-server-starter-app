import type { ExecutionContext, Type } from '@nestjs/common';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { IAuthGuard } from '@nestjs/passport';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom, isObservable } from 'rxjs';
import type { Request as ExpressRequest } from 'express';
import type { OAuthFailureRedirect } from '../exceptions/oauth-authentication-failed.exception';
import { OAuthAuthenticationFailedException } from '../exceptions/oauth-authentication-failed.exception';
import { OAUTH_ERROR, type OAuthError } from '@app/shared/constants';
import { AuthCookies, type ClaimedIntents } from '../utils/auth-cookies';
import type { OAuthProvider } from '../enums/oauth-provider.enum';

// Passport rejects with this message only when the provider's credentials
// are absent and conditionalProvider skipped registering the strategy.
const MISSING_STRATEGY_MESSAGE = 'Unknown authentication strategy';

// Every provider reports a declined consent screen this way (RFC 6749 4.1.2.1),
// and passport-oauth2 turns it into a plain fail() indistinguishable from an
// expired state cookie - so the intent has to be read off the request.
const PROVIDER_CANCELLED_ERROR = 'access_denied';

export interface OAuthProviderGuardOptions {
  provider: OAuthProvider;
  displayName: string;
}

export function createOAuthProviderGuard(
  strategy: string,
  { provider, displayName }: OAuthProviderGuardOptions
): Type<IAuthGuard> {
  @Injectable()
  class OAuthProviderGuard extends AuthGuard(strategy) {
    // A property, so the Passport base constructor keeps its own injection.
    @Inject(AuthCookies) private readonly cookies: AuthCookies;

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
          // eslint-disable-next-line no-restricted-syntax -- a browser navigation, never read by the client error funnel
          throw new NotFoundException(`${displayName} OAuth is not configured`);
        }
        throw error;
      }
    }

    /**
     * The base guard answers a Passport failure with UnauthorizedException, so
     * a denied consent screen, an expired state cookie or a failed code
     * exchange leaves the browser on the API origin looking at a JSON
     * Unauthorized - the callback handler that redirects back to the client is
     * never reached. Throwing here instead lets
     * OAuthAuthenticationExceptionFilter send the user back to the client - to
     * the profile page when the failure ends a link attempt started there.
     * Passport only invokes this hook on success/fail/error, never on the
     * initiation redirect, so both routes of a provider can share it.
     */
    // eslint-disable-next-line no-restricted-syntax -- AuthGuard of @nestjs/passport defines handleRequest
    handleRequest<TUser = unknown>(
      err: unknown,
      user: unknown,
      _info: unknown,
      context: ExecutionContext,
      _status?: unknown
    ): TUser {
      if (err || !user) {
        const request = context.switchToHttp().getRequest<ExpressRequest>();
        const intents = this.cookies.claimedIntents(request);
        throw new OAuthAuthenticationFailedException(
          resolveErrorKey(request, intents),
          {
            reason: err,
            redirectPath: resolveRedirectPath(intents),
            provider
          }
        );
      }
      return user as TUser;
    }
  }
  return OAuthProviderGuard;
}

function resolveErrorKey(
  request: ExpressRequest,
  intents: ClaimedIntents
): OAuthError {
  // A step-up that ends at the provider changed nothing, and the profile page
  // has a message written for exactly that. The callback reads the reauth
  // intent first too, so a flow that claimed both is a step-up here.
  if (intents.reauth !== null) {
    return OAUTH_ERROR.REAUTH_FAILED;
  }
  return request.query?.['error'] === PROVIDER_CANCELLED_ERROR
    ? OAUTH_ERROR.CANCELLED
    : OAUTH_ERROR.AUTH_FAILED;
}

function resolveRedirectPath(intents: ClaimedIntents): OAuthFailureRedirect {
  return intents.link !== null || intents.reauth !== null
    ? '/profile'
    : '/login';
}
