import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
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

function mockResponse(): { redirect: jest.Mock } {
  return { redirect: jest.fn() };
}

describe('OAuthController', () => {
  let controller: OAuthController;
  let authServiceMock: {
    loginWithOAuth: jest.Mock;
  };
  let oauthAccountServiceMock: {
    findByUserId: jest.Mock;
    deleteByUserIdAndProvider: jest.Mock;
  };
  let usersServiceMock: {
    findOne: jest.Mock;
  };

  beforeEach(async () => {
    authServiceMock = {
      loginWithOAuth: jest.fn()
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
        { user: profile },
        res as unknown as Response
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
        { user: profile },
        res as unknown as Response
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
        { user: profile },
        res as unknown as Response
      );

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:4200/login?oauth_error=auth_failed'
      );
    });
  });
});
