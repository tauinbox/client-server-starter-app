import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { Request as ExpressRequest, Response } from 'express';
import { OAuthController } from './oauth.controller';
import { AuthService } from '../services/auth.service';
import { OAuthAccountService } from '../services/oauth-account.service';
import { UsersService } from '../../users/services/users.service';
import { AuditService } from '../../audit/audit.service';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import { JwtAuthRequest } from '../types/auth.request';
import { OAuthUserProfile } from '../types/oauth-profile';

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

function mockExpressRequest(
  user: OAuthUserProfile,
  cookies: Record<string, string> = {}
): ExpressRequest & { user: OAuthUserProfile } {
  return { user, cookies, headers: {}, ip: '127.0.0.1' } as ExpressRequest & {
    user: OAuthUserProfile;
  };
}

describe('OAuthController', () => {
  let controller: OAuthController;
  let jwtServiceMock: {
    sign: jest.Mock;
    verify: jest.Mock;
  };
  let authServiceMock: {
    loginWithOAuth: jest.Mock;
    linkOAuthToUser: jest.Mock;
  };
  let oauthAccountServiceMock: {
    findByUserId: jest.Mock;
    deleteByUserIdAndProvider: jest.Mock;
  };
  let usersServiceMock: {
    findOne: jest.Mock;
  };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    jwtServiceMock = {
      sign: jest.fn().mockReturnValue('signed-link-token'),
      verify: jest.fn().mockReturnValue({ sub: 'user-1' })
    };

    authServiceMock = {
      loginWithOAuth: jest.fn(),
      linkOAuthToUser: jest.fn().mockResolvedValue(undefined)
    };

    oauthAccountServiceMock = {
      findByUserId: jest.fn(),
      deleteByUserIdAndProvider: jest.fn()
    };

    usersServiceMock = {
      findOne: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthController],
      providers: [
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: OAuthAccountService, useValue: oauthAccountServiceMock },
        { provide: UsersService, useValue: usersServiceMock },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn().mockResolvedValue(undefined),
            logFireAndForget: jest.fn()
          }
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'CLIENT_URL') return 'http://localhost:4200';
              if (key === 'JWT_REFRESH_EXPIRATION') return '604800';
              return undefined;
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
    it('should unlink provider when user has other OAuth accounts', async () => {
      oauthAccountServiceMock.findByUserId.mockResolvedValue([
        { provider: 'google', userId: 'user-1' },
        { provider: 'facebook', userId: 'user-1' }
      ]);
      usersServiceMock.findOne.mockResolvedValue({
        id: 'user-1',
        password: null
      });

      const result = await controller.unlinkOAuth(
        'google',
        mockJwtRequest('user-1') as JwtAuthRequest
      );

      expect(
        oauthAccountServiceMock.deleteByUserIdAndProvider
      ).toHaveBeenCalledWith('user-1', 'google');
      expect(result.message).toContain('unlinked');
    });

    it('should throw when trying to unlink last provider without password', async () => {
      oauthAccountServiceMock.findByUserId.mockResolvedValue([
        { provider: 'google', userId: 'user-1' }
      ]);
      usersServiceMock.findOne.mockResolvedValue({
        id: 'user-1',
        password: null
      });

      await expect(
        controller.unlinkOAuth(
          'google',
          mockJwtRequest('user-1') as JwtAuthRequest
        )
      ).rejects.toThrow('Cannot unlink');
    });

    it('should throw when provider is invalid', async () => {
      await expect(
        controller.unlinkOAuth(
          'invalid-provider',
          mockJwtRequest('user-1') as JwtAuthRequest
        )
      ).rejects.toThrow('Invalid OAuth provider');
    });

    it('should allow unlink when user has password', async () => {
      oauthAccountServiceMock.findByUserId.mockResolvedValue([
        { provider: 'google', userId: 'user-1' }
      ]);
      usersServiceMock.findOne.mockResolvedValue({
        id: 'user-1',
        password: 'hashed-password'
      });

      const result = await controller.unlinkOAuth(
        'google',
        mockJwtRequest('user-1') as JwtAuthRequest
      );

      expect(
        oauthAccountServiceMock.deleteByUserIdAndProvider
      ).toHaveBeenCalled();
      expect(result.message).toContain('unlinked');
    });
  });

  describe('initOAuthLink', () => {
    it('should set oauth_link cookie and return message', () => {
      const res = mockResponse();
      const req = mockJwtRequest('user-1');

      const result = controller.initOAuthLink(req as JwtAuthRequest, res);

      expect(jwtServiceMock.sign).toHaveBeenCalledWith(
        { sub: 'user-1' },
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
      authServiceMock.loginWithOAuth.mockResolvedValue(mockAuthResponse);

      const res = mockResponse();
      const profile: OAuthUserProfile = {
        provider: OAuthProvider.GOOGLE,
        providerId: '123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User'
      };

      await controller.googleCallback(mockExpressRequest(profile), res);

      expect(jwtServiceMock.sign).toHaveBeenCalledWith(
        { data: mockAuthResponse },
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
        lastName: 'User'
      };

      await controller.vkCallback(mockExpressRequest(profile), res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:4200/login?oauth_error=no_email'
      );
    });

    it('should redirect to login with error on exception', async () => {
      authServiceMock.loginWithOAuth.mockRejectedValue(new Error('DB error'));

      const res = mockResponse();
      const profile: OAuthUserProfile = {
        provider: OAuthProvider.GOOGLE,
        providerId: '123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User'
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
        lastName: 'User'
      };

      await controller.googleCallback(
        mockExpressRequest(profile, { oauth_link: 'valid-link-token' }),
        res
      );

      expect(jwtServiceMock.verify).toHaveBeenCalledWith('valid-link-token');
      expect(authServiceMock.linkOAuthToUser).toHaveBeenCalledWith(
        'user-1',
        OAuthProvider.GOOGLE,
        '456',
        expect.objectContaining({ ip: '127.0.0.1' })
      );
      expect(res.clearCookie).toHaveBeenCalledWith('oauth_link', {
        path: '/api/v1/auth/oauth'
      });
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:4200/profile?oauth_linked=google'
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
        lastName: 'User'
      };

      await controller.googleCallback(
        mockExpressRequest(profile, { oauth_link: 'bad-token' }),
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
      authServiceMock.loginWithOAuth.mockResolvedValue(mockAuthResponse);

      const res = mockResponse();
      const profile: OAuthUserProfile = {
        provider: OAuthProvider.GOOGLE,
        providerId: '123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User'
      };

      await controller.googleCallback(mockExpressRequest(profile), res);

      expect(authServiceMock.loginWithOAuth).toHaveBeenCalledWith(profile);
      expect(authServiceMock.linkOAuthToUser).not.toHaveBeenCalled();
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
      jwtServiceMock.verify.mockReturnValue({ data: mockPayloadData });

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
});
