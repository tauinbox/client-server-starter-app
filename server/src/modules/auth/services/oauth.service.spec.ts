import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OAuthService } from './oauth.service';
import { UsersService } from '../../users/services/users.service';
import { RefreshTokenService } from './refresh-token.service';
import { OAuthAccountService } from './oauth-account.service';
import { RoleService } from './role.service';
import { TokenGeneratorService } from './token-generator.service';
import { AuditService } from '../../audit/audit.service';
import { OAuthUserProfile } from '../types/oauth-profile';
import { MAX_CONCURRENT_SESSIONS } from '@app/shared/constants/auth.constants';

describe('OAuthService', () => {
  let service: OAuthService;
  let mockRelationQb: {
    relation: jest.Mock;
    of: jest.Mock;
    add: jest.Mock;
  };
  let mockManager: {
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let mockDataSource: {
    transaction: jest.Mock;
  };
  let mockUsersService: {
    findByEmail: jest.Mock;
    findOne: jest.Mock;
    markEmailVerified: jest.Mock;
  };
  let mockConfigService: {
    getOrThrow: jest.Mock;
  };
  let mockRefreshTokenService: {
    createRefreshToken: jest.Mock;
    pruneOldestTokens: jest.Mock;
    deleteByUserId: jest.Mock;
  };
  let mockOAuthAccountService: {
    findByProviderAndProviderId: jest.Mock;
    createOAuthAccount: jest.Mock;
  };
  let mockRoleService: {
    findRoleByName: jest.Mock;
  };
  let mockTokenGenerator: {
    generateTokens: jest.Mock;
  };
  let mockAuditService: {
    log: jest.Mock;
    logFireAndForget: jest.Mock;
  };

  const mockUserRole = {
    id: 'role-uuid-user',
    name: 'user',
    description: null,
    isSystem: true,
    isSuper: false,
    rolePermissions: [],
    users: [],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01')
  };

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    password: '$2b$10$hashedpassword',
    isActive: true,
    isEmailVerified: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    roles: [mockUserRole]
  };

  beforeEach(async () => {
    mockRelationQb = {
      relation: jest.fn().mockReturnThis(),
      of: jest.fn().mockReturnThis(),
      add: jest.fn().mockResolvedValue(undefined)
    };

    mockManager = {
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockRelationQb)
    };

    mockDataSource = {
      transaction: jest
        .fn()
        .mockImplementation(
          (callback: (manager: typeof mockManager) => Promise<unknown>) =>
            callback(mockManager)
        )
    };

    mockUsersService = {
      findByEmail: jest.fn(),
      findOne: jest.fn(),
      markEmailVerified: jest.fn().mockResolvedValue(undefined)
    };

    mockConfigService = {
      getOrThrow: jest.fn().mockImplementation((key: string) => {
        const config: Record<string, string> = {
          JWT_REFRESH_EXPIRATION: '604800'
        };
        const value = config[key];
        if (value === undefined) {
          throw new Error(`Configuration key "${key}" does not exist`);
        }
        return value;
      })
    };

    mockRefreshTokenService = {
      createRefreshToken: jest.fn().mockResolvedValue(undefined),
      pruneOldestTokens: jest.fn().mockResolvedValue(undefined),
      deleteByUserId: jest.fn().mockResolvedValue(undefined)
    };

    mockOAuthAccountService = {
      findByProviderAndProviderId: jest.fn(),
      createOAuthAccount: jest.fn().mockResolvedValue(undefined)
    };

    mockRoleService = {
      findRoleByName: jest
        .fn()
        .mockResolvedValue({ id: 'role-uuid', name: 'user' })
    };

    mockTokenGenerator = {
      generateTokens: jest.fn().mockReturnValue({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600
      })
    };

    mockAuditService = {
      log: jest.fn().mockResolvedValue(undefined),
      logFireAndForget: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: UsersService, useValue: mockUsersService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RefreshTokenService, useValue: mockRefreshTokenService },
        { provide: OAuthAccountService, useValue: mockOAuthAccountService },
        { provide: RoleService, useValue: mockRoleService },
        { provide: TokenGeneratorService, useValue: mockTokenGenerator },
        { provide: AuditService, useValue: mockAuditService }
      ]
    }).compile();

    service = module.get<OAuthService>(OAuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('loginWithOAuth', () => {
    const oauthProfile: OAuthUserProfile = {
      provider: 'google',
      providerId: 'google-123',
      email: 'oauth@example.com',
      firstName: 'OAuth',
      lastName: 'User'
    };

    const oauthUser = {
      ...mockUser,
      id: 'oauth-user-1',
      email: 'oauth@example.com',
      firstName: 'OAuth',
      lastName: 'User',
      password: null,
      isEmailVerified: true
    };

    it('should login returning OAuth user', async () => {
      const existingOAuth = {
        id: '1',
        provider: 'google',
        providerId: 'google-123',
        userId: 'oauth-user-1'
      };
      mockOAuthAccountService.findByProviderAndProviderId.mockResolvedValue(
        existingOAuth
      );
      mockUsersService.findOne.mockResolvedValue(oauthUser);

      const result = await service.loginWithOAuth(oauthProfile);

      expect(result.user.email).toBe('oauth@example.com');
      expect(result.tokens).toBeDefined();
      expect(mockRefreshTokenService.deleteByUserId).not.toHaveBeenCalled();
      expect(mockRefreshTokenService.pruneOldestTokens).toHaveBeenCalledWith(
        'oauth-user-1',
        MAX_CONCURRENT_SESSIONS
      );
      // Regression (BKL-002): OAuth response must carry roles as RoleResponse[].
      expect(result.user.roles).toEqual([mockUserRole]);
    });

    it('should auto-verify email for returning OAuth user', async () => {
      const unverifiedOauthUser = {
        ...oauthUser,
        isEmailVerified: false
      };
      const existingOAuth = {
        id: '1',
        provider: 'google',
        providerId: 'google-123',
        userId: 'oauth-user-1'
      };
      mockOAuthAccountService.findByProviderAndProviderId.mockResolvedValue(
        existingOAuth
      );
      mockUsersService.findOne.mockResolvedValue(unverifiedOauthUser);

      await service.loginWithOAuth(oauthProfile);

      expect(mockUsersService.markEmailVerified).toHaveBeenCalledWith(
        'oauth-user-1'
      );
    });

    it('should throw when returning OAuth user is deactivated', async () => {
      const existingOAuth = {
        id: '1',
        provider: 'google',
        providerId: 'google-123',
        userId: 'oauth-user-1'
      };
      mockOAuthAccountService.findByProviderAndProviderId.mockResolvedValue(
        existingOAuth
      );
      mockUsersService.findOne.mockResolvedValue({
        ...oauthUser,
        isActive: false
      });

      await expect(service.loginWithOAuth(oauthProfile)).rejects.toThrow(
        HttpException
      );
    });

    it('should link OAuth to existing user found by email', async () => {
      mockOAuthAccountService.findByProviderAndProviderId.mockResolvedValue(
        null
      );
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        email: 'oauth@example.com'
      });

      const result = await service.loginWithOAuth(oauthProfile);

      expect(mockOAuthAccountService.createOAuthAccount).toHaveBeenCalledWith(
        mockUser.id,
        'google',
        'google-123'
      );
      expect(result.user).toBeDefined();
    });

    it('should throw when existing user by email is deactivated', async () => {
      mockOAuthAccountService.findByProviderAndProviderId.mockResolvedValue(
        null
      );
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        email: 'oauth@example.com',
        isActive: false
      });

      await expect(service.loginWithOAuth(oauthProfile)).rejects.toThrow(
        HttpException
      );
    });

    it('should create new user and OAuth account atomically when no existing account found', async () => {
      mockOAuthAccountService.findByProviderAndProviderId.mockResolvedValue(
        null
      );
      mockUsersService.findByEmail.mockResolvedValue(null);
      mockManager.save.mockResolvedValueOnce(oauthUser).mockResolvedValueOnce({
        id: 'oauth-account-1',
        userId: 'oauth-user-1',
        provider: 'google',
        providerId: 'google-123'
      });
      // After the transaction, oauth.service re-reads the user with
      // `roles` relation hydrated so the response carries RoleResponse[].
      mockUsersService.findOne.mockResolvedValue(oauthUser);

      const result = await service.loginWithOAuth(oauthProfile);

      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          email: 'oauth@example.com',
          firstName: 'OAuth',
          lastName: 'User',
          password: null,
          isEmailVerified: true
        })
      );
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: 'oauth-user-1',
          provider: 'google',
          providerId: 'google-123'
        })
      );
      expect(mockUsersService.findOne).toHaveBeenCalledWith('oauth-user-1');
      expect(result.user).toBeDefined();
      // Regression (BKL-002): new OAuth user response carries RoleResponse[].
      expect(result.user.roles).toEqual([mockUserRole]);
    });
  });

  describe('linkOAuthToUser', () => {
    it('should link OAuth account to active user', async () => {
      mockUsersService.findOne.mockResolvedValue(mockUser);

      await service.linkOAuthToUser('user-1', 'google', 'google-123');

      expect(mockUsersService.findOne).toHaveBeenCalledWith('user-1');
      expect(mockOAuthAccountService.createOAuthAccount).toHaveBeenCalledWith(
        'user-1',
        'google',
        'google-123'
      );
    });

    it('should throw when user is deactivated', async () => {
      const inactiveUser = { ...mockUser, isActive: false };
      mockUsersService.findOne.mockResolvedValue(inactiveUser);

      await expect(
        service.linkOAuthToUser('user-1', 'google', 'google-123')
      ).rejects.toThrow(HttpException);
    });

    it('should throw HttpException when OAuth account linked to another user', async () => {
      mockUsersService.findOne.mockResolvedValue(mockUser);
      mockOAuthAccountService.createOAuthAccount.mockRejectedValue({
        code: '23505'
      });
      mockOAuthAccountService.findByProviderAndProviderId.mockResolvedValue({
        userId: 'other-user-id',
        provider: 'google',
        providerId: 'google-123'
      });

      await expect(
        service.linkOAuthToUser('user-1', 'google', 'google-123')
      ).rejects.toThrow(HttpException);
    });

    it('should silently succeed when OAuth account already linked to same user', async () => {
      mockUsersService.findOne.mockResolvedValue(mockUser);
      mockOAuthAccountService.createOAuthAccount.mockRejectedValue({
        code: '23505'
      });
      mockOAuthAccountService.findByProviderAndProviderId.mockResolvedValue({
        userId: 'user-1',
        provider: 'google',
        providerId: 'google-123'
      });

      await expect(
        service.linkOAuthToUser('user-1', 'google', 'google-123')
      ).resolves.toBeUndefined();
    });

    it('should rethrow non-unique-violation errors', async () => {
      mockUsersService.findOne.mockResolvedValue(mockUser);
      const dbError = new Error('Connection lost');
      mockOAuthAccountService.createOAuthAccount.mockRejectedValue(dbError);

      await expect(
        service.linkOAuthToUser('user-1', 'google', 'google-123')
      ).rejects.toThrow('Connection lost');
    });
  });
});
