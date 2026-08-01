import { ArgumentsHost, Logger } from '@nestjs/common';
import { OAuthAuthenticationExceptionFilter } from './oauth-authentication-exception.filter';
import {
  OAUTH_ERROR_AUTH_FAILED,
  OAUTH_ERROR_CANCELLED,
  OAuthAuthenticationFailedException
} from '../exceptions/oauth-authentication-failed.exception';

describe('OAuthAuthenticationExceptionFilter', () => {
  const clientUrl = 'http://localhost:4200';
  let filter: OAuthAuthenticationExceptionFilter;
  let redirect: jest.Mock;
  let clearCookie: jest.Mock;
  let host: ArgumentsHost;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    filter = new OAuthAuthenticationExceptionFilter(clientUrl);
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
    expect(clearCookie).toHaveBeenCalledWith('oauth_link', {
      path: '/api/v1/auth/oauth'
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
