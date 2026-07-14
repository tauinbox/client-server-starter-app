import type { CanActivate, ExecutionContext, Type } from '@nestjs/common';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom, isObservable } from 'rxjs';

// Passport rejects with this message only when the provider's credentials
// are absent and conditionalProvider skipped registering the strategy.
const MISSING_STRATEGY_MESSAGE = 'Unknown authentication strategy';

export function createOAuthProviderGuard(
  strategy: string,
  providerName: string
): Type<CanActivate> {
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
  }
  return OAuthProviderGuard;
}
