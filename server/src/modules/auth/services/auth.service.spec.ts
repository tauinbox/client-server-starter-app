import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  UnauthorizedException
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../../users/services/users.service';
import { RefreshTokenService } from './refresh-token.service';
import { OAuthAccountService } from './oauth-account.service';
import { PermissionService } from './permission.service';
import { RoleService } from './role.service';
import { MailService } from '../../mail/mail.service';
import { OAuthUserProfile } from '../types/oauth-profile';
import { MAX_CONCURRENT_SESSIONS } from '@app/shared/constants/auth.constants';

describe('AuthService', () => {
  let service: AuthService;
  let mockRelationQb: {
    relation: jest.Mock;
    of: jest.Mock;
    add: jest.Mock;
    remove: jest.Mock;
  };
  let mockManager: {
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let mockDataSource: {
    transaction: jest.Mock;
  };
  let mockUsersService: {
    findByEmail: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    createOAuthUser: jest.Mock;
    incrementFailedAttemptsAndLockIfNeeded: jest.Mock;
    resetLoginAttempts: jest.Mock;
    setEmailVerificationToken: jest.Mock;
    findByEmailVerificationToken: jest.Mock;
    markEmailVerified: jest.Mock;
    setPasswordResetToken: jest.Mock;
    findByPasswordResetToken: jest.Mock;
    clearPasswordResetToken: jest.Mock;
    update: jest.Mock;
  };
  let mockJwtService: {
    sign: jest.Mock;
  };
  let mockConfigService: {
    get: jest.Mock;
  };
  let mockRefreshTokenService: {
    createRefreshToken: jest.Mock;
    findByToken: jest.Mock;
    deleteByUserId: jest.Mock;
    revokeToken: jest.Mock;
    pruneOldestTokens: jest.Mock;
  };
  let mockOAuthAccountService: {
    findByProviderAndProviderId: jest.Mock;
    createOAuthAccount: jest.Mock;
  };
  let mockMailService: {
    sendEmailVerification: jest.Mock;
    sendPasswordReset: jest.Mock;
  };
  let mockPermissionService: {
    getRoleNamesForUser: jest.Mock;
    invalidateUserPermissions: jest.Mock;
  };
  let mockRoleService: {
    findRoleByName: jest.Mock;
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
    emailVerificationToken: null,
    emailVerificationExpiresAt: null,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01')
  };

  const mockUserResponse = {
    id: mockUser.id,
    email: mockUser.email,
    firstName: mockUser.firstName,
    lastName: mockUser.lastName,
    isActive: mockUser.isActive,
    roles: [] as string[],
    isEmailVerified: mockUser.isEmailVerified,
    failedLoginAttempts: mockUser.failedLoginAttempts,
    lockedUntil: mockUser.lockedUntil,
    emailVerificationToken: mockUser.emailVerificationToken,
    emailVerificationExpiresAt: mockUser.emailVerificationExpiresAt,
    passwordResetToken: mockUser.passwordResetToken,
    passwordResetExpiresAt: mockUser.passwordResetExpiresAt,
    createdAt: mockUser.createdAt,
    updatedAt: mockUser.updatedAt
  };

  beforeEach(async () => {
    mockRelationQb = {
      relation: jest.fn().mockReturnThis(),
      of: jest.fn().mockReturnThis(),
      add: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined)
    };

    mockManager = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
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
      create: jest.fn(),
      createOAuthUser: jest.fn(),
      incrementFailedAttemptsAndLockIfNeeded: jest.fn().mockResolvedValue({
        failedLoginAttempts: 1,
        lockedUntil: null
      }),
      resetLoginAttempts: jest.fn().mockResolvedValue(undefined),
      setEmailVerificationToken: jest.fn().mockResolvedValue(undefined),
      findByEmailVerificationToken: jest.fn(),
      markEmailVerified: jest.fn().mockResolvedValue(undefined),
      setPasswordResetToken: jest.fn().mockResolvedValue(undefined),
      findByPasswordResetToken: jest.fn(),
      clearPasswordResetToken: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(mockUser)
    };

    mockJwtService = {
      sign: jest.fn().mockReturnValue('mock-access-token')
    };

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        const config: Record<string, string> = {
          JWT_EXPIRATION: '3600',
          JWT_REFRESH_EXPIRATION: '604800'
        };
        return config[key];
      })
    };

    mockRefreshTokenService = {
      createRefreshToken: jest.fn().mockResolvedValue(undefined),
      findByToken: jest.fn(),
      deleteByUserId: jest.fn().mockResolvedValue(undefined),
      revokeToken: jest.fn().mockResolvedValue(undefined),
      pruneOldestTokens: jest.fn().mockResolvedValue(undefined)
    };

    mockOAuthAccountService = {
      findByProviderAndProviderId: jest.fn(),
      createOAuthAccount: jest.fn().mockResolvedValue(undefined)
    };

    mockMailService = {
      sendEmailVerification: jest.fn().mockResolvedValue(undefined),
      sendPasswordReset: jest.fn().mockResolvedValue(undefined)
    };

    mockPermissionService = {
      getRoleNamesForUser: jest.fn().mockResolvedValue(['user']),
      invalidateUserPermissions: jest.fn().mockResolvedValue(undefined)
    };

    mockRoleService = {
      findRoleByName: jest
        .fn()
        .mockResolvedValue({ id: 'role-uuid', name: 'user' })
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RefreshTokenService, useValue: mockRefreshTokenService },
        { provide: OAuthAccountService, useValue: mockOAuthAccountService },
        { provide: PermissionService, useValue: mockPermissionService },
        { provide: RoleService, useValue: mockRoleService },
        { provide: MailService, useValue: mockMailService }
      ]
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUser', () => {
    it('should return user without password when credentials are valid', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.validateUser('test@example.com', 'password');

      expect(result).toEqual(mockUserResponse);
      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(
        'test@example.com'
      );
    });

    it('should throw UnauthorizedException when password does not match', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.validateUser('test@example.com', 'wrong-password')
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user does not exist', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.validateUser('nonexistent@example.com', 'password')
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user is inactive', async () => {
      const inactiveUser = { ...mockUser, isActive: false };
      mockUsersService.findByEmail.mockResolvedValue(inactiveUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await expect(
        service.validateUser('test@example.com', 'password')
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user has no password (OAuth-only)', async () => {
      const oauthUser = { ...mockUser, password: null };
      mockUsersService.findByEmail.mockResolvedValue(oauthUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.validateUser('test@example.com', 'password')
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should use dummy hash for timing attack protection when user not found', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      const compareSpy = jest
        .spyOn(bcrypt, 'compare')
        .mockResolvedValue(false as never);

      await expect(
        service.validateUser('nonexistent@example.com', 'password')
      ).rejects.toThrow(UnauthorizedException);

      // bcrypt.compare should still be called (with dummy hash) for constant-time behavior
      expect(compareSpy).toHaveBeenCalled();
    });

    it('should throw 423 when account is locked', async () => {
      const lockedUser = {
        ...mockUser,
        lockedUntil: new Date(Date.now() + 600000) // 10 min from now
      };
      mockUsersService.findByEmail.mockResolvedValue(lockedUser);

      try {
        await service.validateUser('test@example.com', 'password');
        fail('Expected HttpException');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.LOCKED);
        const response = (error as HttpException).getResponse();
        expect(response).toHaveProperty('lockedUntil');
        expect(response).toHaveProperty('retryAfter');
      }
    });

    it('should lock account after 5 failed attempts', async () => {
      const userNearLockout = { ...mockUser, failedLoginAttempts: 4 };
      mockUsersService.findByEmail.mockResolvedValue(userNearLockout);
      const lockedUntil = new Date(Date.now() + 900000);
      mockUsersService.incrementFailedAttemptsAndLockIfNeeded.mockResolvedValue(
        {
          failedLoginAttempts: 5,
          lockedUntil
        }
      );
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      try {
        await service.validateUser('test@example.com', 'wrong-password');
        fail('Expected HttpException');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.LOCKED);
      }

      expect(
        mockUsersService.incrementFailedAttemptsAndLockIfNeeded
      ).toHaveBeenCalledWith('user-1', expect.any(Number), expect.any(Number));
    });

    it('should throw 403 when email is not verified', async () => {
      const unverifiedUser = { ...mockUser, isEmailVerified: false };
      mockUsersService.findByEmail.mockResolvedValue(unverifiedUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      try {
        await service.validateUser('test@example.com', 'password');
        fail('Expected HttpException');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
        const response = (error as HttpException).getResponse();
        expect(response).toHaveProperty('errorCode', 'EMAIL_NOT_VERIFIED');
      }
    });

    it('should reset failed attempts on successful login', async () => {
      const userWithAttempts = { ...mockUser, failedLoginAttempts: 3 };
      mockUsersService.findByEmail.mockResolvedValue(userWithAttempts);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await service.validateUser('test@example.com', 'password');

      expect(mockUsersService.resetLoginAttempts).toHaveBeenCalledWith(
        'user-1'
      );
    });

    it('should not reset attempts when count is zero', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await service.validateUser('test@example.com', 'password');

      expect(mockUsersService.resetLoginAttempts).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should create a new session token and prune oldest beyond limit', async () => {
      const result = await service.login(mockUserResponse);

      expect(mockRefreshTokenService.deleteByUserId).not.toHaveBeenCalled();
      expect(mockRefreshTokenService.createRefreshToken).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
        604800
      );
      expect(mockRefreshTokenService.pruneOldestTokens).toHaveBeenCalledWith(
        'user-1',
        MAX_CONCURRENT_SESSIONS
      );
      expect(result.tokens.access_token).toBe('mock-access-token');
      expect(typeof result.tokens.refresh_token).toBe('string');
      expect(result.tokens.expires_in).toBe(3600);
      expect(result.user).toEqual({ ...mockUserResponse, roles: ['user'] });
    });

    it('should use default expiration when config is not set', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      const result = await service.login(mockUserResponse);

      expect(result.tokens.expires_in).toBe(3600);
      expect(mockRefreshTokenService.createRefreshToken).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
        604800
      );
    });

    it('should sign JWT with correct payload', async () => {
      await service.login(mockUserResponse);

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        {
          sub: 'user-1',
          email: 'test@example.com',
          roles: ['user']
        },
        { expiresIn: 3600 }
      );
    });
  });

  describe('register', () => {
    const registerDto = {
      email: 'new@example.com',
      password: 'Password1',
      firstName: 'Jane',
      lastName: 'Doe'
    };

    const savedUser = { ...mockUser, ...registerDto, id: 'new-user-1' };

    it('should create user with verification token atomically and send email', async () => {
      mockManager.findOne.mockResolvedValue(null); // no conflict
      mockManager.save.mockResolvedValue(savedUser);

      const result = await service.register(registerDto);

      expect(mockDataSource.transaction).toHaveBeenCalled();
      // User should be saved with verification token fields included
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.anything(), // User entity class
        expect.objectContaining({
          email: 'new@example.com',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          emailVerificationToken: expect.any(String),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          emailVerificationExpiresAt: expect.any(Date)
        })
      );
      expect(mockMailService.sendEmailVerification).toHaveBeenCalledWith(
        'new@example.com',
        expect.any(String)
      );
      expect(result.message).toContain('Registration successful');
    });

    it('should throw ConflictException when email already exists', async () => {
      mockManager.findOne.mockResolvedValue(mockUser); // conflict

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException
      );
      expect(mockManager.save).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    it('should verify email with valid token', async () => {
      const user = {
        ...mockUser,
        isEmailVerified: false,
        emailVerificationExpiresAt: new Date(Date.now() + 86400000)
      };
      mockUsersService.findByEmailVerificationToken.mockResolvedValue(user);

      const result = await service.verifyEmail('valid-token');

      expect(mockUsersService.markEmailVerified).toHaveBeenCalledWith('user-1');
      expect(result.message).toContain('verified successfully');
    });

    it('should throw 400 when token not found', async () => {
      mockUsersService.findByEmailVerificationToken.mockResolvedValue(null);

      await expect(service.verifyEmail('invalid-token')).rejects.toThrow(
        HttpException
      );
    });

    it('should throw 400 when token is expired', async () => {
      const user = {
        ...mockUser,
        emailVerificationExpiresAt: new Date(Date.now() - 1000)
      };
      mockUsersService.findByEmailVerificationToken.mockResolvedValue(user);

      try {
        await service.verifyEmail('expired-token');
        fail('Expected HttpException');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(
          HttpStatus.BAD_REQUEST
        );
      }
    });
  });

  describe('resendVerificationEmail', () => {
    it('should resend verification email for unverified user', async () => {
      const unverifiedUser = { ...mockUser, isEmailVerified: false };
      mockUsersService.findByEmail.mockResolvedValue(unverifiedUser);

      const result = await service.resendVerificationEmail('test@example.com');

      expect(mockUsersService.setEmailVerificationToken).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
        expect.any(Date)
      );
      expect(mockMailService.sendEmailVerification).toHaveBeenCalled();
      expect(result.message).toBeDefined();
    });

    it('should return success even when user not found (prevent enumeration)', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);

      const result = await service.resendVerificationEmail(
        'nonexistent@example.com'
      );

      expect(mockMailService.sendEmailVerification).not.toHaveBeenCalled();
      expect(result.message).toBeDefined();
    });

    it('should return success when user already verified', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser); // isEmailVerified: true

      const result = await service.resendVerificationEmail('test@example.com');

      expect(mockMailService.sendEmailVerification).not.toHaveBeenCalled();
      expect(result.message).toBeDefined();
    });
  });

  describe('forgotPassword', () => {
    it('should send password reset email for valid user', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);

      const result = await service.forgotPassword('test@example.com');

      expect(mockUsersService.setPasswordResetToken).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
        expect.any(Date)
      );
      expect(mockMailService.sendPasswordReset).toHaveBeenCalledWith(
        'test@example.com',
        expect.any(String)
      );
      expect(result.message).toBeDefined();
    });

    it('should return success even when user not found (prevent enumeration)', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);

      const result = await service.forgotPassword('nonexistent@example.com');

      expect(mockMailService.sendPasswordReset).not.toHaveBeenCalled();
      expect(result.message).toBeDefined();
    });
  });

  describe('resetPassword', () => {
    it('should reset password, clear token, and invalidate sessions atomically', async () => {
      const user = {
        ...mockUser,
        passwordResetExpiresAt: new Date(Date.now() + 3600000)
      };
      mockUsersService.findByPasswordResetToken.mockResolvedValue(user);

      const result = await service.resetPassword('valid-token', 'NewPassword1');

      expect(mockDataSource.transaction).toHaveBeenCalled();
      // Password update + token clear in one manager.update call
      expect(mockManager.update).toHaveBeenCalledWith(
        expect.anything(), // User entity class
        'user-1',
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          password: expect.any(String), // bcrypt hash
          passwordResetToken: null,
          passwordResetExpiresAt: null
        })
      );
      // Session invalidation
      expect(mockManager.delete).toHaveBeenCalledWith(
        expect.anything(), // RefreshToken entity class
        { userId: 'user-1' }
      );
      expect(result.message).toContain('reset successfully');
    });

    it('should throw 400 when token not found', async () => {
      mockUsersService.findByPasswordResetToken.mockResolvedValue(null);

      await expect(
        service.resetPassword('invalid-token', 'NewPassword1')
      ).rejects.toThrow(HttpException);
    });

    it('should throw 400 when token is expired', async () => {
      const user = {
        ...mockUser,
        passwordResetExpiresAt: new Date(Date.now() - 1000)
      };
      mockUsersService.findByPasswordResetToken.mockResolvedValue(user);

      try {
        await service.resetPassword('expired-token', 'NewPassword1');
        fail('Expected HttpException');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(
          HttpStatus.BAD_REQUEST
        );
      }
    });
  });

  describe('logout', () => {
    it('should delete all refresh tokens for the user', async () => {
      await service.logout('user-1');

      expect(mockRefreshTokenService.deleteByUserId).toHaveBeenCalledWith(
        'user-1'
      );
    });
  });

  describe('refreshTokens', () => {
    const mockTokenDoc = {
      id: 'token-1',
      token: 'hashed-token',
      userId: 'user-1',
      revoked: false,
      expiresAt: new Date(Date.now() + 86400000),
      isExpired: () => false
    };

    it('should issue new tokens and revoke old token atomically', async () => {
      mockRefreshTokenService.findByToken.mockResolvedValue(mockTokenDoc);
      mockUsersService.findOne.mockResolvedValue(mockUser);

      const result = await service.refreshTokens('valid-refresh-token');

      expect(mockRefreshTokenService.findByToken).toHaveBeenCalledWith(
        'valid-refresh-token'
      );
      // Revoke + create happen inside a transaction via manager
      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(mockManager.update).toHaveBeenCalled();
      expect(mockManager.save).toHaveBeenCalled();
      expect(result.tokens.access_token).toBe('mock-access-token');
      expect(typeof result.tokens.refresh_token).toBe('string');
      expect(result.tokens.expires_in).toBe(3600);
      expect(result.user).toEqual(
        expect.objectContaining({
          id: 'user-1',
          email: 'test@example.com',
          roles: ['user']
        })
      );
    });

    it('should throw UnauthorizedException when token not found', async () => {
      mockRefreshTokenService.findByToken.mockResolvedValue(null);

      await expect(service.refreshTokens('invalid-token')).rejects.toThrow(
        UnauthorizedException
      );
    });

    it('should throw UnauthorizedException when token is revoked', async () => {
      const revokedToken = { ...mockTokenDoc, revoked: true };
      mockRefreshTokenService.findByToken.mockResolvedValue(revokedToken);

      await expect(service.refreshTokens('revoked-token')).rejects.toThrow(
        UnauthorizedException
      );
    });

    it('should throw UnauthorizedException when token is expired', async () => {
      const expiredToken = { ...mockTokenDoc, isExpired: () => true };
      mockRefreshTokenService.findByToken.mockResolvedValue(expiredToken);

      await expect(service.refreshTokens('expired-token')).rejects.toThrow(
        UnauthorizedException
      );
    });

    it('should throw UnauthorizedException when user not found', async () => {
      mockRefreshTokenService.findByToken.mockResolvedValue(mockTokenDoc);
      mockUsersService.findOne.mockRejectedValue(
        new UnauthorizedException('User not found')
      );

      await expect(
        service.refreshTokens('valid-refresh-token')
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should revoke token and throw when user is deactivated', async () => {
      const inactiveUser = { ...mockUser, isActive: false };
      mockRefreshTokenService.findByToken.mockResolvedValue(mockTokenDoc);
      mockUsersService.findOne.mockResolvedValue(inactiveUser);

      await expect(
        service.refreshTokens('valid-refresh-token')
      ).rejects.toThrow(UnauthorizedException);

      expect(mockRefreshTokenService.revokeToken).toHaveBeenCalledWith(
        'token-1'
      );
    });
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
        UnauthorizedException
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
        UnauthorizedException
      );
    });

    it('should create new user and OAuth account atomically when no existing account found', async () => {
      mockOAuthAccountService.findByProviderAndProviderId.mockResolvedValue(
        null
      );
      mockUsersService.findByEmail.mockResolvedValue(null);
      // manager.save called twice: first for User, then for OAuthAccount
      mockManager.save.mockResolvedValueOnce(oauthUser).mockResolvedValueOnce({
        id: 'oauth-account-1',
        userId: 'oauth-user-1',
        provider: 'google',
        providerId: 'google-123'
      });

      const result = await service.loginWithOAuth(oauthProfile);

      expect(mockDataSource.transaction).toHaveBeenCalled();
      // First save: User with OAuth profile data
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.anything(), // User entity class
        expect.objectContaining({
          email: 'oauth@example.com',
          firstName: 'OAuth',
          lastName: 'User',
          password: null,
          isEmailVerified: true
        })
      );
      // Second save: OAuthAccount linking user to provider
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.anything(), // OAuthAccount entity class
        expect.objectContaining({
          userId: 'oauth-user-1',
          provider: 'google',
          providerId: 'google-123'
        })
      );
      expect(result.user).toBeDefined();
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
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw ConflictException when OAuth account linked to another user', async () => {
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
      ).rejects.toThrow(ConflictException);
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
