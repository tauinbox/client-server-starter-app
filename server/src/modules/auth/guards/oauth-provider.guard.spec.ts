import type { ExecutionContext } from '@nestjs/common';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { of, type Observable } from 'rxjs';

type CanActivateResult = boolean | Promise<boolean> | Observable<boolean>;
const mockBaseCanActivate = jest.fn<CanActivateResult, [ExecutionContext]>();

jest.mock('@nestjs/passport', () => ({
  AuthGuard: jest.fn(
    () =>
      class {
        canActivate(context: ExecutionContext) {
          return mockBaseCanActivate(context);
        }
      }
  )
}));

import { AuthGuard } from '@nestjs/passport';
import { GoogleOAuthGuard } from './google-oauth.guard';
import { FacebookOAuthGuard } from './facebook-oauth.guard';
import { VkOAuthGuard } from './vk-oauth.guard';
import {
  OAUTH_ERROR_AUTH_FAILED,
  OAuthAuthenticationFailedException
} from '../exceptions/oauth-authentication-failed.exception';

const context = {} as ExecutionContext;

describe.each([
  ['GoogleOAuthGuard', GoogleOAuthGuard, 'google', 'Google'],
  ['FacebookOAuthGuard', FacebookOAuthGuard, 'facebook', 'Facebook'],
  ['VkOAuthGuard', VkOAuthGuard, 'vkontakte', 'VK']
])('%s', (_name, GuardClass, strategy, providerName) => {
  beforeEach(() => {
    mockBaseCanActivate.mockReset();
  });

  it(`registers the '${strategy}' passport strategy`, () => {
    expect(AuthGuard).toHaveBeenCalledWith(strategy);
  });

  it('returns true when the underlying guard resolves', async () => {
    mockBaseCanActivate.mockResolvedValue(true);
    await expect(new GuardClass().canActivate(context)).resolves.toBe(true);
  });

  it('resolves an observable result from the underlying guard', async () => {
    mockBaseCanActivate.mockReturnValue(of(true));
    await expect(new GuardClass().canActivate(context)).resolves.toBe(true);
  });

  it('maps a missing-strategy error to 404 "not configured"', async () => {
    mockBaseCanActivate.mockRejectedValue(
      new Error(`Unknown authentication strategy "${strategy}"`)
    );
    await expect(new GuardClass().canActivate(context)).rejects.toThrow(
      new NotFoundException(`${providerName} OAuth is not configured`)
    );
  });

  it('rethrows an UnauthorizedException from the callback phase unchanged', async () => {
    const callbackError = new UnauthorizedException(
      'Unable to verify authorization request state.'
    );
    mockBaseCanActivate.mockRejectedValue(callbackError);
    await expect(new GuardClass().canActivate(context)).rejects.toBe(
      callbackError
    );
  });

  describe('handleRequest', () => {
    it('raises a redirectable failure when Passport rejects the request', () => {
      expect(() =>
        new GuardClass().handleRequest<unknown>(null, false, undefined, context)
      ).toThrow(OAuthAuthenticationFailedException);
    });

    it('carries the underlying error as the reason', () => {
      const cause = new Error('Failed to obtain access token');

      let thrown: unknown;
      try {
        new GuardClass().handleRequest<unknown>(
          cause,
          undefined,
          undefined,
          context
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(OAuthAuthenticationFailedException);
      const failure = thrown as OAuthAuthenticationFailedException;
      expect(failure.reason).toBe(cause);
      expect(failure.oauthError).toBe(OAUTH_ERROR_AUTH_FAILED);
    });

    it('returns the authenticated profile untouched', () => {
      const profile = { email: 'user@example.com' };

      expect(
        new GuardClass().handleRequest<unknown>(
          null,
          profile,
          undefined,
          context
        )
      ).toBe(profile);
    });
  });

  it('rethrows a non-configuration error unchanged instead of masking it as 404', async () => {
    const exchangeError = new Error('Failed to obtain access token');
    mockBaseCanActivate.mockRejectedValue(exchangeError);
    await expect(new GuardClass().canActivate(context)).rejects.toBe(
      exchangeError
    );
  });

  it('rethrows a synchronously thrown error unchanged', async () => {
    const syncError = new Error('boom');
    mockBaseCanActivate.mockImplementation(() => {
      throw syncError;
    });
    await expect(new GuardClass().canActivate(context)).rejects.toBe(syncError);
  });
});
