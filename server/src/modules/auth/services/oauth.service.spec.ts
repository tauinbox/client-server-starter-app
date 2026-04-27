import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OAuthService } from './oauth.service';
import { UsersService } from '../../users/services/users.service';
import { RefreshTokenService } from './refresh-token.service';
import { OAuthAccountService } from './oauth-account.service';
import { RoleService } from './role.service';
import { TokenGeneratorService } from './token-generator.service';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { OAuthUserProfile } from '../types/oauth-profile';
import { ErrorKeys } from '@app/shared/constants';
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
  let mockMailService: {
    sendEmailVerification: jest.Mock;
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

    mockMailService = {
      sendEmailVerification: jest.fn().mockResolvedValue(undefined)
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
        { provide: AuditService, useValue: mockAuditService },
        { provide: MailService, useValue: mockMailService }
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
      lastName: 'User',
      emailVerified: true
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
      // OAuth response must carry roles as RoleResponse[] (not string[]).
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

    // Auto-link is disabled. When a local account already exists for the
    // OAuth-asserted email but no OAuth row matches, we MUST throw and
    // refuse to create the link silently.
    it('should throw OAUTH_EMAIL_ALREADY_REGISTERED when local account exists for the email', async () => {
      mockOAuthAccountService.findByProviderAndProviderId.mockResolvedValue(
        null
      );
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        email: 'oauth@example.com'
      });

      await expect(service.loginWithOAuth(oauthProfile)).rejects.toMatchObject({
        constructor: HttpException,
        status: HttpStatus.CONFLICT,
        response: {
          errorKey: ErrorKeys.AUTH.OAUTH_EMAIL_ALREADY_REGISTERED
        }
      });

      // Side-effect assertion: NO OAuth account row created, NO tokens issued.
      expect(mockOAuthAccountService.createOAuthAccount).not.toHaveBeenCalled();
      expect(mockManager.save).not.toHaveBeenCalled();
      expect(mockTokenGenerator.generateTokens).not.toHaveBeenCalled();
      expect(mockRefreshTokenService.createRefreshToken).not.toHaveBeenCalled();
    });

    it('should throw OAUTH_EMAIL_ALREADY_REGISTERED even if the existing local account is deactivated', async () => {
      mockOAuthAccountService.findByProviderAndProviderId.mockResolvedValue(
        null
      );
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        email: 'oauth@example.com',
        isActive: false
      });

      await expect(service.loginWithOAuth(oauthProfile)).rejects.toMatchObject({
        response: {
          errorKey: ErrorKeys.AUTH.OAUTH_EMAIL_ALREADY_REGISTERED
        }
      });
    });

    it('should create new verified user when provider asserts emailVerified=true', async () => {
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
          isEmailVerified: true,
          emailVerificationToken: null,
          emailVerificationExpiresAt: null
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
      // Verification email is NOT sent when provider already verified.
      expect(mockMailService.sendEmailVerification).not.toHaveBeenCalled();
      expect(result.user).toBeDefined();
      // New OAuth user response carries RoleResponse[] (not string[]).
      expect(result.user.roles).toEqual([mockUserRole]);
    });

    // When the provider does NOT assert email verification (e.g. VK, or
    // Google/Facebook returning verified=false), we create the user with
    // isEmailVerified=false and trigger a verification email. Otherwise an
    // attacker controlling an unverified provider profile could be granted
    // a verified-status local account.
    it('should create unverified user and send verification email when provider asserts emailVerified=false', async () => {
      const unverifiedProfile: OAuthUserProfile = {
        ...oauthProfile,
        emailVerified: false
      };
      mockOAuthAccountService.findByProviderAndProviderId.mockResolvedValue(
        null
      );
      mockUsersService.findByEmail.mockResolvedValue(null);
      mockManager.save
        .mockResolvedValueOnce({ ...oauthUser, isEmailVerified: false })
        .mockResolvedValueOnce({
          id: 'oauth-account-1',
          userId: 'oauth-user-1',
          provider: 'google',
          providerId: 'google-123'
        });
      mockUsersService.findOne.mockResolvedValue({
        ...oauthUser,
        isEmailVerified: false
      });

      await service.loginWithOAuth(unverifiedProfile);

      expect(mockManager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          email: 'oauth@example.com',
          isEmailVerified: false,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          emailVerificationToken: expect.any(String),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          emailVerificationExpiresAt: expect.any(Date)
        })
      );
      expect(mockMailService.sendEmailVerification).toHaveBeenCalledTimes(1);
      const callArgs = mockMailService.sendEmailVerification.mock.calls[0] as [
        string,
        string
      ];
      expect(callArgs[0]).toBe('oauth@example.com');
      // Token passed to mail is the RAW token, not the hashed one stored.
      expect(typeof callArgs[1]).toBe('string');
      expect(callArgs[1]).toHaveLength(64); // 32 bytes hex
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
