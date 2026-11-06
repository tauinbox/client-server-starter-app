import { ArgumentsHost, Logger } from '@nestjs/common';
import { OAuthAuthenticationExceptionFilter } from './oauth-authentication-exception.filter';
import { OAuthAuthenticationFailedException } from '../exceptions/oauth-authentication-failed.exception';
import {
  OAUTH_ERROR,
  TOKEN_PURPOSE,
  type OAuthError
} from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { AuthCookies } from '../utils/auth-cookies';
import { OAuthFailureAudit } from '../utils/oauth-failure-audit';
import { bindIntent } from '../utils/oauth-flow-intent';
import { OAuthProvider } from '../enums/oauth-provider.enum';

describe('OAuthAuthenticationExceptionFilter', () => {
  const clientUrl = 'http://localhost:4200';
  const flowState = 'a1b2c3';
  let filter: OAuthAuthenticationExceptionFilter;
  let redirect: jest.Mock;
  let clearCookie: jest.Mock;
  let host: ArgumentsHost;
  let warn: jest.SpyInstance;
  let environment: string;
  let requestCookies: Record<string, string>;
  let logFireAndForget: jest.Mock;
  let recordAuthEvent: jest.Mock;
  let verify: jest.Mock;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    environment = 'production';
    requestCookies = {};
    const configService = { get: jest.fn(() => environment) };
    // @ts-expect-error - partial mock: AuthCookies only reads ConfigService.get here
    const cookies = new AuthCookies(configService);

    logFireAndForget = jest.fn();
    recordAuthEvent = jest.fn();
    verify = jest.fn(() => null);
    const failureAudit = new OAuthFailureAudit(
      // @ts-expect-error - partial mock: only logFireAndForget is called
      { logFireAndForget },
      { recordAuthEvent },
      { verify },
      cookies
    );

    filter = new OAuthAuthenticationExceptionFilter(
      clientUrl,
      cookies,
      failureAudit
    );
    redirect = jest.fn();
    clearCookie = jest.fn();
    const mockResponse = { redirect, clearCookie };
    const mockRequest = {
      cookies: requestCookies,
      query: { state: flowState },
      ip: '127.0.0.1'
    };

    host = {
      switchToHttp: () => ({
        // @ts-expect-error testing mock
        getResponse: () => mockResponse,
        // @ts-expect-error testing mock
        getRequest: () => mockRequest
      })
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function failure(
    oauthError: OAuthError = OAUTH_ERROR.AUTH_FAILED
  ): OAuthAuthenticationFailedException {
    return new OAuthAuthenticationFailedException(oauthError, {
      provider: OAuthProvider.GOOGLE
    });
  }

  it('redirects to the client login page carrying the error key', () => {
    filter.catch(
      new OAuthAuthenticationFailedException(OAUTH_ERROR.AUTH_FAILED),
      host
    );

    expect(redirect).toHaveBeenCalledWith(
      `${clientUrl}/login?oauth_error=auth_failed`
    );
    expect(clearCookie).not.toHaveBeenCalled();
  });

  it('sends a failed link flow back to the profile page and drops the link cookie', () => {
    requestCookies['__Host-oauth_link'] = bindIntent('link-token', flowState);

    filter.catch(
      new OAuthAuthenticationFailedException(OAUTH_ERROR.CANCELLED, {
        redirectPath: '/profile'
      }),
      host
    );

    expect(redirect).toHaveBeenCalledWith(
      `${clientUrl}/profile?oauth_error=oauth_cancelled`
    );
    expect(clearCookie).toHaveBeenCalledTimes(1);
    expect(clearCookie).toHaveBeenCalledWith('__Host-oauth_link', {
      secure: true,
      path: '/'
    });
  });

  it('sends a failed step-up back to the profile page and drops the reauth cookie', () => {
    requestCookies['__Host-oauth_reauth'] = bindIntent(
      'reauth-token',
      flowState
    );

    filter.catch(
      new OAuthAuthenticationFailedException(OAUTH_ERROR.REAUTH_FAILED, {
        redirectPath: '/profile'
      }),
      host
    );

    expect(redirect).toHaveBeenCalledWith(
      `${clientUrl}/profile?oauth_error=reauth_failed`
    );
    expect(clearCookie).toHaveBeenCalledTimes(1);
    expect(clearCookie).toHaveBeenCalledWith('__Host-oauth_reauth', {
      secure: true,
      path: '/'
    });
  });

  it('keeps an intent that another flow claimed', () => {
    requestCookies['__Host-oauth_link'] = bindIntent('link-token', 'other');
    requestCookies['__Host-oauth_reauth'] = bindIntent('reauth-token', 'other');

    filter.catch(failure(OAUTH_ERROR.CANCELLED), host);

    expect(clearCookie).not.toHaveBeenCalled();
  });

  // The browser keeps a `__Host-` cookie whose expiring write lacks Secure,
  // and `local` runs on plain HTTP under the bare name.
  it('clears the bare names without Secure in local', () => {
    environment = 'local';
    requestCookies['oauth_link'] = bindIntent('link-token', flowState);
    requestCookies['oauth_reauth'] = bindIntent('reauth-token', flowState);

    filter.catch(
      new OAuthAuthenticationFailedException(OAUTH_ERROR.REAUTH_FAILED, {
        redirectPath: '/profile'
      }),
      host
    );

    expect(clearCookie).toHaveBeenCalledWith('oauth_link', {
      secure: false,
      path: '/'
    });
    expect(clearCookie).toHaveBeenCalledWith('oauth_reauth', {
      secure: false,
      path: '/'
    });
  });

  it('logs the underlying reason so the failure stays diagnosable', () => {
    filter.catch(
      new OAuthAuthenticationFailedException(OAUTH_ERROR.AUTH_FAILED, {
        reason: new Error('Failed to obtain access token')
      }),
      host
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to obtain access token')
    );
  });

  describe('audit', () => {
    const context = { ip: '127.0.0.1', requestId: undefined };

    it('writes a refused sign-in row when no intent cookie is present', () => {
      filter.catch(failure(OAUTH_ERROR.CANCELLED), host);

      expect(logFireAndForget).toHaveBeenCalledTimes(1);
      expect(logFireAndForget).toHaveBeenCalledWith({
        action: AuditAction.USER_LOGIN_FAILURE,
        details: {
          method: 'oauth',
          provider: OAuthProvider.GOOGLE,
          reason: OAUTH_ERROR.CANCELLED
        },
        context
      });
      expect(recordAuthEvent).toHaveBeenCalledWith('login_failure');
    });

    it('writes a step-up row that names the account of a verified reauth intent', () => {
      requestCookies['__Host-oauth_reauth'] = bindIntent(
        'reauth-token',
        flowState
      );
      verify.mockReturnValue({
        sub: 'user-1',
        email: 'owner@example.com',
        operation: 'email_change',
        iat: 1
      });

      filter.catch(failure(OAUTH_ERROR.REAUTH_FAILED), host);

      expect(verify).toHaveBeenCalledWith(
        'reauth-token',
        TOKEN_PURPOSE.OAUTH_REAUTH
      );
      expect(logFireAndForget).toHaveBeenCalledTimes(1);
      expect(logFireAndForget).toHaveBeenCalledWith({
        action: AuditAction.STEP_UP_FAILURE,
        actorId: 'user-1',
        actorEmail: 'owner@example.com',
        targetId: 'user-1',
        targetType: 'User',
        details: {
          operation: 'email_change',
          factor: 'reauth_proof',
          provider: OAuthProvider.GOOGLE,
          reason: OAUTH_ERROR.REAUTH_FAILED
        },
        context
      });
      expect(recordAuthEvent).not.toHaveBeenCalled();
    });

    it('writes a link row that names the account of a verified link intent', () => {
      requestCookies['__Host-oauth_link'] = bindIntent('link-token', flowState);
      verify.mockReturnValue({
        sub: 'user-1',
        email: 'owner@example.com',
        iat: 1
      });

      filter.catch(failure(OAUTH_ERROR.CANCELLED), host);

      expect(verify).toHaveBeenCalledWith(
        'link-token',
        TOKEN_PURPOSE.OAUTH_LINK
      );
      expect(logFireAndForget).toHaveBeenCalledTimes(1);
      expect(logFireAndForget).toHaveBeenCalledWith({
        action: AuditAction.OAUTH_LINK_FAILURE,
        actorId: 'user-1',
        actorEmail: 'owner@example.com',
        targetId: 'user-1',
        targetType: 'User',
        details: {
          provider: OAuthProvider.GOOGLE,
          reason: OAUTH_ERROR.CANCELLED
        },
        context
      });
    });

    it('falls back to a refused sign-in row when the intent does not verify', () => {
      requestCookies['__Host-oauth_reauth'] = bindIntent('forged', flowState);

      filter.catch(failure(OAUTH_ERROR.REAUTH_FAILED), host);

      expect(logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.USER_LOGIN_FAILURE })
      );
    });

    it('ignores an intent that another flow claimed', () => {
      requestCookies['__Host-oauth_reauth'] = bindIntent(
        'reauth-token',
        'other-state'
      );
      verify.mockReturnValue({ sub: 'user-1', iat: 1 });

      filter.catch(failure(OAUTH_ERROR.REAUTH_FAILED), host);

      expect(verify).not.toHaveBeenCalled();
      expect(logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.USER_LOGIN_FAILURE })
      );
    });
  });
});
