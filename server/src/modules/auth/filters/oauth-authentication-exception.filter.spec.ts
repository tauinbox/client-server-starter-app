import { ArgumentsHost, Logger } from '@nestjs/common';
import { OAuthAuthenticationExceptionFilter } from './oauth-authentication-exception.filter';
import {
  OAUTH_ERROR_AUTH_FAILED,
  OAUTH_ERROR_CANCELLED,
  OAUTH_ERROR_REAUTH_FAILED,
  OAuthAuthenticationFailedException
} from '../exceptions/oauth-authentication-failed.exception';

describe('OAuthAuthenticationExceptionFilter', () => {
  const clientUrl = 'http://localhost:4200';
  let filter: OAuthAuthenticationExceptionFilter;
  let redirect: jest.Mock;
  let clearCookie: jest.Mock;
  let host: ArgumentsHost;
  let warn: jest.SpyInstance;
  let environment: string;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    environment = 'production';
    const configService = { get: jest.fn(() => environment) };
    // @ts-expect-error - partial mock: the filter only reads ConfigService.get
    filter = new OAuthAuthenticationExceptionFilter(clientUrl, configService);
    redirect = jest.fn();
    clearCookie = jest.fn();
    const mockResponse = { redirect, clearCookie };
    host = {
      switchToHttp: () => ({
        // @ts-expect-error testing mock
        getResponse: () => mockResponse
      })
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('redirects to the client login page carrying the error key', () => {
    filter.catch(
      new OAuthAuthenticationFailedException(OAUTH_ERROR_AUTH_FAILED),
      host
    );

    expect(redirect).toHaveBeenCalledWith(
      `${clientUrl}/login?oauth_error=auth_failed`
    );
    expect(clearCookie).not.toHaveBeenCalled();
  });

  it('sends a failed link flow back to the profile page and drops the link cookie', () => {
    filter.catch(
      new OAuthAuthenticationFailedException(
        OAUTH_ERROR_CANCELLED,
        undefined,
        '/profile'
      ),
      host
    );

    expect(redirect).toHaveBeenCalledWith(
      `${clientUrl}/profile?oauth_error=oauth_cancelled`
    );
    expect(clearCookie).toHaveBeenCalledWith('__Host-oauth_link', {
      secure: true,
      path: '/'
    });
  });

  it('sends a failed step-up back to the profile page and drops the reauth cookie', () => {
    filter.catch(
      new OAuthAuthenticationFailedException(
        OAUTH_ERROR_REAUTH_FAILED,
        undefined,
        '/profile'
      ),
      host
    );

    expect(redirect).toHaveBeenCalledWith(
      `${clientUrl}/profile?oauth_error=reauth_failed`
    );
    expect(clearCookie).toHaveBeenCalledWith('__Host-oauth_reauth', {
      secure: true,
      path: '/'
    });
  });

  // The browser keeps a `__Host-` cookie whose expiring write lacks Secure,
  // and `local` runs on plain HTTP under the bare name.
  it('clears the bare names without Secure in local', () => {
    environment = 'local';

    filter.catch(
      new OAuthAuthenticationFailedException(
        OAUTH_ERROR_REAUTH_FAILED,
        undefined,
        '/profile'
      ),
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
      new OAuthAuthenticationFailedException(
        OAUTH_ERROR_AUTH_FAILED,
        new Error('Failed to obtain access token')
      ),
      host
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to obtain access token')
    );
  });
});
