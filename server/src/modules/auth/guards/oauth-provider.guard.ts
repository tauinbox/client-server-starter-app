import type { ExecutionContext, Type } from '@nestjs/common';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { IAuthGuard } from '@nestjs/passport';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom, isObservable } from 'rxjs';
import {
  OAUTH_ERROR_AUTH_FAILED,
  OAuthAuthenticationFailedException
} from '../exceptions/oauth-authentication-failed.exception';

// Passport rejects with this message only when the provider's credentials
// are absent and conditionalProvider skipped registering the strategy.
const MISSING_STRATEGY_MESSAGE = 'Unknown authentication strategy';

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
     * user back to the login page. Passport only invokes this hook on
     * success/fail/error, never on the initiation redirect, so both routes of
     * a provider can share it.
     */
    handleRequest<TUser = unknown>(
      err: unknown,
      user: unknown,
      _info: unknown,
      _context: ExecutionContext,
      _status?: unknown
    ): TUser {
      if (err || !user) {
        throw new OAuthAuthenticationFailedException(
          OAUTH_ERROR_AUTH_FAILED,
          err
        );
      }
      return user as TUser;
    }
  }
  return OAuthProviderGuard;
}
