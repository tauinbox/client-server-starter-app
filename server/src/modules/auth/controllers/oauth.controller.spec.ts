import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request as ExpressRequest, Response } from 'express';
import { OAuthController } from './oauth.controller';
import { AuthService } from '../services/auth.service';
import { OAuthAccountService } from '../services/oauth-account.service';
import { UsersService } from '../../users/services/users.service';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import { JwtAuthRequest } from '../types/auth.request';
import { OAuthUserProfile } from '../types/oauth-profile';

function mockJwtRequest(userId: string): { user: JwtAuthRequest['user'] } {
  return {
    user: { userId, email: 'test@example.com', isAdmin: false }
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
  return { user, cookies } as ExpressRequest & { user: OAuthUserProfile };
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
          provide: ConfigService,
          useValue: {
            get: jest
              .fn()
              .mockImplementation((key: string) =>
                key === 'CLIENT_URL' ? 'http://localhost:4200' : undefined
              )
          }
        }
      ]
    }).compile();

    controller = module.get<OAuthController>(OAuthController);
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

      const result = controller.initOAuthLink(
        req as JwtAuthRequest,
        res
      );

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
    it('should redirect with encoded auth response on success', async () => {
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

      await controller.googleCallback(
        mockExpressRequest(profile),
        res
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:4200/oauth/callback#data=')
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

      await controller.vkCallback(
        mockExpressRequest(profile),
        res
      );

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

      await controller.googleCallback(
        mockExpressRequest(profile),
        res
      );

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
        '456'
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

      await controller.googleCallback(
        mockExpressRequest(profile),
        res
      );

      expect(authServiceMock.loginWithOAuth).toHaveBeenCalledWith(profile);
      expect(authServiceMock.linkOAuthToUser).not.toHaveBeenCalled();
    });
  });
});
