import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request as ExpressRequest, Response } from 'express';
import { OAuthController } from './oauth.controller';
import { CLIENT_URL } from '../providers/client-url.provider';
import { OAuthService } from '../services/oauth.service';
import { OAuthAccountService } from '../services/oauth-account.service';
import { AuditService } from '../../audit/audit.service';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import { JwtAuthRequest } from '../types/auth.request';
import { OAuthUserProfile } from '../types/oauth-profile';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { ErrorKeys, TOKEN_PURPOSE } from '@app/shared/constants';
import { bindLinkIntent } from '../utils/oauth-link-intent';

// Seconds, as a JWT `iat` is.
const LINK_TOKEN_IAT = Math.floor(
  new Date('2026-01-01T00:00:00Z').getTime() / 1000
);

function mockJwtRequest(userId: string): {
  user: JwtAuthRequest['user'];
  headers: Record<string, string>;
  ip: string;
} {
  return {
    user: { userId, email: 'test@example.com', roles: [] },
    headers: {},
    ip: '127.0.0.1'
  };
}

type MockedResponse = {
  redirect: jest.Mock;
  clearCookie: jest.Mock;
  cookie: jest.Mock;
};

function mockResponse(): MockedResponse & Response {
  return {
    redirect: jest.fn(),
    clearCookie: jest.fn(),
    cookie: jest.fn()
  } as MockedResponse & Response;
}

// The state that CookieStateStore minted for the flow under test. The link
// intent is consumable by the flow that carries this state and by no other.
const FLOW_STATE = 'a'.repeat(64);

function mockExpressRequest(
  user: OAuthUserProfile,
  cookies: Record<string, string> = {},
  state: string = FLOW_STATE
): ExpressRequest & { user: OAuthUserProfile } {
  // @ts-expect-error testing mock
  const req: ExpressRequest & { user: OAuthUserProfile } = {
    user,
    cookies,
    query: { state },
    headers: {},
    ip: '127.0.0.1'
  };
  return req;
}

/** Builds the cookie the store writes once a flow claims the intent. */
function linkCookie(token: string, state: string = FLOW_STATE) {
  return { oauth_link: bindLinkIntent(token, state) };
}

describe('OAuthController', () => {
  let controller: OAuthController;
  let jwtServiceMock: {
    sign: jest.Mock;
    verify: jest.Mock;
  };
  let oauthServiceMock: {
    loginWithOAuth: jest.Mock;
    linkOAuthToUser: jest.Mock;
  };
  let oauthAccountServiceMock: {
    findByUserId: jest.Mock;
    unlinkProvider: jest.Mock;
  };
  let auditServiceMock: {
    log: jest.Mock;
    logFireAndForget: jest.Mock;
  };
  let configValues: Record<string, string | undefined>;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    jwtServiceMock = {
      sign: jest.fn().mockReturnValue('signed-link-token'),
      verify: jest.fn().mockReturnValue({
        sub: 'user-1',
        purpose: TOKEN_PURPOSE.OAUTH_LINK,
        iat: LINK_TOKEN_IAT
      })
    };

    oauthServiceMock = {
      loginWithOAuth: jest.fn(),
      linkOAuthToUser: jest.fn().mockResolvedValue(undefined)
    };

    oauthAccountServiceMock = {
      findByUserId: jest.fn(),
      unlinkProvider: jest.fn().mockResolvedValue(undefined)
    };

    auditServiceMock = {
      log: jest.fn().mockResolvedValue(undefined),
      logFireAndForget: jest.fn()
    };

    configValues = {
      CLIENT_URL: 'http://localhost:4200',
      JWT_REFRESH_EXPIRATION: '604800'
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthController],
      providers: [
        { provide: CLIENT_URL, useValue: configValues['CLIENT_URL'] },
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: OAuthService, useValue: oauthServiceMock },
        { provide: OAuthAccountService, useValue: oauthAccountServiceMock },
        { provide: AuditService, useValue: auditServiceMock },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              return configValues[key];
            }),
            getOrThrow: jest.fn().mockImplementation((key: string) => {
              const value = configValues[key];
              if (value === undefined) {
                throw new TypeError(
                  `Configuration key "${key}" does not exist`
                );
              }
              return value;
            })
          }
        }
      ]
    }).compile();

    controller = module.get<OAuthController>(OAuthController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getOAuthAccounts', () => {
    it('should return mapped OAuth accounts for user', async () => {
      const mockAccounts = [
        {
          id: '1',
          provider: 'google',
          providerId: '123',
          userId: 'user-1',
          createdAt: new Date('2024-01-01')
        }
      ];
      oauthAccountServiceMock.findByUserId.mockResolvedValue(mockAccounts);

      const result = await controller.getOAuthAccounts(
        mockJwtRequest('user-1') as JwtAuthRequest
      );

      expect(result).toEqual([
        { provider: 'google', createdAt: new Date('2024-01-01') }
      ]);
    });
  });

  describe('unlinkOAuth', () => {
    it('should delegate to the service and audit the unlink', async () => {
      const result = await controller.unlinkOAuth(
        'google',
        mockJwtRequest('user-1') as JwtAuthRequest
      );

      expect(oauthAccountServiceMock.unlinkProvider).toHaveBeenCalledWith(
        'user-1',
        'google'
      );
      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.OAUTH_UNLINK,
          details: { provider: 'google' }
        })
      );
      expect(result.message).toContain('unlinked');
    });

    it('should not write an audit row when the unlink is rejected', async () => {
      oauthAccountServiceMock.unlinkProvider.mockRejectedValue(
        new HttpException(
          {
            message: 'No linked google account found',
            errorKey: ErrorKeys.AUTH.OAUTH_PROVIDER_NOT_LINKED
          },
          HttpStatus.NOT_FOUND
        )
      );

      await expect(
        controller.unlinkOAuth(
          'google',
          mockJwtRequest('user-1') as JwtAuthRequest
        )
      ).rejects.toThrow('No linked google account found');
      expect(auditServiceMock.log).not.toHaveBeenCalled();
    });

    it('should throw when provider is invalid', async () => {
      await expect(
        controller.unlinkOAuth(
          'invalid-provider',
          mockJwtRequest('user-1') as JwtAuthRequest
        )
      ).rejects.toThrow('Invalid OAuth provider');
      expect(oauthAccountServiceMock.unlinkProvider).not.toHaveBeenCalled();
    });
  });

  describe('initOAuthLink', () => {
    it('should set oauth_link cookie and return message', () => {
      const res = mockResponse();
      const req = mockJwtRequest('user-1');

      const result = controller.initOAuthLink(req as JwtAuthRequest, res);

      expect(jwtServiceMock.sign).toHaveBeenCalledWith(
        { sub: 'user-1', purpose: TOKEN_PURPOSE.OAUTH_LINK },
        { expiresIn: 300 }
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'oauth_link',
        'signed-link-token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/api/v1/auth/oauth'
        })
      );
      expect(result).toEqual({ message: 'Link initiated' });
    });
  });

  describe('handleOAuthCallback', () => {
    it('should set oauth_data cookie and redirect without fragment on success', async () => {
      const mockAuthResponse = {
        tokens: {
          access_token: 'token',
          refresh_token: 'refresh',
          expires_in: 3600
        },
        user: { id: '1', email: 'test@example.com' }
      };
      // The full auth response (with refresh_token) is passed into the JWT payload;
      // the controller's exchangeOAuthData strips refresh_token before returning to client
      oauthServiceMock.loginWithOAuth.mockResolvedValue(mockAuthResponse);

      const res = mockResponse();
      const profile: OAuthUserProfile = {
        provider: OAuthProvider.GOOGLE,
        providerId: '123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        emailVerified: true
      };

      await controller.googleCallback(mockExpressRequest(profile), res);

      expect(jwtServiceMock.sign).toHaveBeenCalledWith(
        { data: mockAuthResponse, purpose: TOKEN_PURPOSE.OAUTH_DATA },
        { expiresIn: 60 }
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'oauth_data',
        'signed-link-token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/api/v1/auth/oauth'
        })
      );
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:4200/oauth/callback'
      );
    });

    it('should redirect to login with error when no email', async () => {
      const res = mockResponse();
      const profile: OAuthUserProfile = {
        provider: OAuthProvider.VK,
        providerId: '123',
        email: '',
        firstName: 'Test',
        lastName: 'User',
        emailVerified: false
      };

      await controller.vkCallback(mockExpressRequest(profile), res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:4200/login?oauth_error=no_email'
      );
    });

    // When OAuthService throws OAUTH_EMAIL_ALREADY_REGISTERED, the controller
    // redirects with a specific oauth_error param so the login page can show
    // the right translated message.
    it('should redirect with email_already_registered when service throws OAUTH_EMAIL_ALREADY_REGISTERED', async () => {
      oauthServiceMock.loginWithOAuth.mockRejectedValue(
        new HttpException(
          {
            message: 'This email is already registered',
            errorKey: ErrorKeys.AUTH.OAUTH_EMAIL_ALREADY_REGISTERED
          },
          HttpStatus.CONFLICT
        )
      );

      const res = mockResponse();
      const profile: OAuthUserProfile = {
        provider: OAuthProvider.GOOGLE,
        providerId: '999',
        email: 'taken@example.com',
        firstName: 'Test',
        lastName: 'User',
        emailVerified: true
      };

      await controller.googleCallback(mockExpressRequest(profile), res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:4200/login?oauth_error=email_already_registered'
      );
      // Must NOT set the oauth_data cookie when login was rejected.
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('should redirect to login with error on exception', async () => {
      oauthServiceMock.loginWithOAuth.mockRejectedValue(new Error('DB error'));

      const res = mockResponse();
      const profile: OAuthUserProfile = {
        provider: OAuthProvider.GOOGLE,
        providerId: '123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        emailVerified: true
      };

      await controller.googleCallback(mockExpressRequest(profile), res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:4200/login?oauth_error=auth_failed'
      );
    });

    it('should link OAuth account when oauth_link cookie is present', async () => {
      const res = mockResponse();
      const profile: OAuthUserProfile = {
        provider: OAuthProvider.GOOGLE,
        providerId: '456',
        email: 'different@example.com',
        firstName: 'Test',
        lastName: 'User',
        emailVerified: true
      };

      await controller.googleCallback(
        mockExpressRequest(profile, linkCookie('valid-link-token')),
        res
      );

      expect(jwtServiceMock.verify).toHaveBeenCalledWith('valid-link-token');
      expect(oauthServiceMock.linkOAuthToUser).toHaveBeenCalledWith(
        'user-1',
        OAuthProvider.GOOGLE,
        '456',
        LINK_TOKEN_IAT,
        expect.objectContaining({ ip: '127.0.0.1' })
      );
      expect(res.clearCookie).toHaveBeenCalledWith('oauth_link', {
        path: '/api/v1/auth/oauth'
      });
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:4200/profile?oauth_linked=google'
      );
    });

    // The service compares the issue time against the last session revocation,
    // so a token that carries none must be refused, never linked on trust.
    it('should not link the account when the token carries no issue time', async () => {
      jwtServiceMock.verify.mockReturnValue({
        sub: 'user-1',
        purpose: TOKEN_PURPOSE.OAUTH_LINK
      });

      const res = mockResponse();
      const profile: OAuthUserProfile = {
        provider: OAuthProvider.GOOGLE,
        providerId: '456',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        emailVerified: true
      };

      await controller.googleCallback(
        mockExpressRequest(profile, linkCookie('link-token-without-iat')),
        res
      );

      expect(oauthServiceMock.linkOAuthToUser).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:4200/profile?oauth_error=link_failed'
      );
    });

    // Regression: every token is signed with the same key, so the link flow
    // must reject one minted for a different purpose rather than trusting `sub`
    it('should not link the account when the token was minted for another purpose', async () => {
      jwtServiceMock.verify.mockReturnValue({
        sub: 'user-1',
        purpose: TOKEN_PURPOSE.ACCESS
      });

      const res = mockResponse();
      const profile: OAuthUserProfile = {
        provider: OAuthProvider.GOOGLE,
        providerId: '456',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        emailVerified: true
      };

      await controller.googleCallback(
        mockExpressRequest(profile, linkCookie('access-token')),
        res
      );

      expect(oauthServiceMock.linkOAuthToUser).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:4200/profile?oauth_error=link_failed'
      );
    });

    it('should redirect to profile with error when link token is invalid', async () => {
      jwtServiceMock.verify.mockImplementation(() => {
        throw new Error('invalid token');
      });

      const res = mockResponse();
      const profile: OAuthUserProfile = {
        provider: OAuthProvider.GOOGLE,
        providerId: '456',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        emailVerified: true
      };

      await controller.googleCallback(
        mockExpressRequest(profile, linkCookie('bad-token')),
        res
      );

      expect(res.clearCookie).toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:4200/profile?oauth_error=link_failed'
      );
    });

    it('should use loginWithOAuth when no link cookie present', async () => {
      const mockAuthResponse = {
        tokens: {
          access_token: 'token',
          refresh_token: 'refresh',
          expires_in: 3600
        },
        user: { id: '1', email: 'test@example.com' }
      };
      oauthServiceMock.loginWithOAuth.mockResolvedValue(mockAuthResponse);

      const res = mockResponse();
      const profile: OAuthUserProfile = {
        provider: OAuthProvider.GOOGLE,
        providerId: '123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        emailVerified: true
      };

      await controller.googleCallback(mockExpressRequest(profile), res);

      expect(oauthServiceMock.loginWithOAuth).toHaveBeenCalledWith(profile);
      expect(oauthServiceMock.linkOAuthToUser).not.toHaveBeenCalled();
    });

    // The link cookie names a user, never a flow. Somebody who signs in at an
    // abandoned browser starts their own flow, so their callback must stay a
    // sign-in rather than hand their identity to the account that walked away.
    it('should sign in, not link, when the intent belongs to another flow', async () => {
      oauthServiceMock.loginWithOAuth.mockResolvedValue({
        tokens: { access_token: 'token' },
        user: { id: '2', email: 'stranger@example.com' }
      });

      const res = mockResponse();
      const profile: OAuthUserProfile = {
        provider: OAuthProvider.GOOGLE,
        providerId: 'stranger-456',
        email: 'stranger@example.com',
        firstName: 'Stranger',
        lastName: 'Person',
        emailVerified: true
      };

      const abandonedState = 'b'.repeat(64);
      await controller.googleCallback(
        mockExpressRequest(
          profile,
          linkCookie('valid-link-token', abandonedState)
        ),
        res
      );

      expect(oauthServiceMock.linkOAuthToUser).not.toHaveBeenCalled();
      expect(oauthServiceMock.loginWithOAuth).toHaveBeenCalledWith(profile);
      // The abandoned flow may still finish, so its intent is left in place.
      expect(res.clearCookie).not.toHaveBeenCalled();
    });

    // An intent that reaches a callback without passing through the store
    // belongs to no flow, so nothing may consume it.
    it('should sign in, not link, when the intent is bound to no flow', async () => {
      oauthServiceMock.loginWithOAuth.mockResolvedValue({
        tokens: { access_token: 'token' },
        user: { id: '2', email: 'stranger@example.com' }
      });

      const res = mockResponse();
      const profile: OAuthUserProfile = {
        provider: OAuthProvider.GOOGLE,
        providerId: 'stranger-456',
        email: 'stranger@example.com',
        firstName: 'Stranger',
        lastName: 'Person',
        emailVerified: true
      };

      await controller.googleCallback(
        mockExpressRequest(profile, { oauth_link: 'valid-link-token' }),
        res
      );

      expect(oauthServiceMock.linkOAuthToUser).not.toHaveBeenCalled();
      expect(oauthServiceMock.loginWithOAuth).toHaveBeenCalledWith(profile);
    });
  });

  describe('exchangeOAuthData', () => {
    it('should set refresh_token cookie and return auth data without refresh_token', () => {
      const mockPayloadData = {
        tokens: {
          access_token: 'token',
          refresh_token: 'refresh',
          expires_in: 3600
        },
        user: { id: '1', email: 'test@example.com' }
      };
      jwtServiceMock.verify.mockReturnValue({
        data: mockPayloadData,
        purpose: TOKEN_PURPOSE.OAUTH_DATA
      });

      const req = mockExpressRequest({} as OAuthUserProfile, {
        oauth_data: 'signed-jwt'
      });
      const res = mockResponse();

      const result = controller.exchangeOAuthData(req, res);

      expect(jwtServiceMock.verify).toHaveBeenCalledWith('signed-jwt');
      expect(res.clearCookie).toHaveBeenCalledWith('oauth_data', {
        path: '/api/v1/auth/oauth'
      });
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          path: '/api/v1/auth'
        })
      );
      expect(result).toEqual({
        tokens: { access_token: 'token', expires_in: 3600 },
        user: { id: '1', email: 'test@example.com' }
      });
    });

    it('should throw BadRequestException when cookie is missing', () => {
      const req = mockExpressRequest({} as OAuthUserProfile, {});
      const res = mockResponse();

      expect(() => controller.exchangeOAuthData(req, res)).toThrow(
        'Missing OAuth data'
      );
    });

    // Regression: a missing JWT_REFRESH_EXPIRATION must fail loudly. The
    // pre-fix code computed a NaN maxAge and silently set a session cookie.
    it('should throw a configuration error and set no cookie when JWT_REFRESH_EXPIRATION is missing', () => {
      delete configValues['JWT_REFRESH_EXPIRATION'];
      jwtServiceMock.verify.mockReturnValue({
        data: {
          tokens: {
            access_token: 'token',
            refresh_token: 'refresh',
            expires_in: 3600
          },
          user: { id: '1', email: 'test@example.com' }
        },
        purpose: TOKEN_PURPOSE.OAUTH_DATA
      });

      const req = mockExpressRequest({} as OAuthUserProfile, {
        oauth_data: 'signed-jwt'
      });
      const res = mockResponse();

      expect(() => controller.exchangeOAuthData(req, res)).toThrow(
        'JWT_REFRESH_EXPIRATION'
      );
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when JWT is expired', () => {
      jwtServiceMock.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      const req = mockExpressRequest({} as OAuthUserProfile, {
        oauth_data: 'expired-jwt'
      });
      const res = mockResponse();

      expect(() => controller.exchangeOAuthData(req, res)).toThrow(
        'Invalid or expired OAuth data'
      );
    });
  });

  describe('facebookCallback', () => {
    it('should delegate to handleOAuthCallback and redirect on success', async () => {
      const mockAuthResponse = {
        tokens: {
          access_token: 'token',
          refresh_token: 'refresh',
          expires_in: 3600
        },
        user: { id: '1', email: 'test@example.com' }
      };
      oauthServiceMock.loginWithOAuth.mockResolvedValue(mockAuthResponse);

      const res = mockResponse();
      const profile: OAuthUserProfile = {
        provider: OAuthProvider.GOOGLE,
        providerId: '789',
        email: 'fb@example.com',
        firstName: 'Face',
        lastName: 'Book',
        emailVerified: true
      };

      await controller.facebookCallback(mockExpressRequest(profile), res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:4200/oauth/callback'
      );
    });
  });
});
