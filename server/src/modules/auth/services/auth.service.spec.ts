import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { instanceToPlain } from 'class-transformer';
import * as bcrypt from 'bcrypt';
import {
  PasswordHashVersion,
  prehashPassword
} from '../../../common/utils/password-hash';
import { AuthService } from './auth.service';
import { User } from '../../users/entities/user.entity';
import { UsersService } from '../../users/services/users.service';
import { RefreshTokenService } from './refresh-token.service';
import { RefreshToken } from '../entities/refresh-token.entity';
import { RoleService } from './role.service';
import { TokenGeneratorService } from './token-generator.service';
import {
  BCRYPT_SALT_ROUNDS,
  DEFAULT_SESSION_ABSOLUTE_MAX_MS,
  ErrorKeys,
  MAX_CONCURRENT_SESSIONS,
  MAX_FAILED_ATTEMPTS,
  REFRESH_REUSE_GRACE_MS,
  STEP_UP_OPERATION,
  TOKEN_PURPOSE
} from '@app/shared/constants';
import { MailService } from '../../mail/mail.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { MetricsService } from '../../core/metrics/metrics.service';
import { BreachedPasswordService } from '../breached-password/breached-password.service';
import { MfaService } from './mfa.service';
import { SessionIssuerService } from './session-issuer.service';
import { SessionLimitService } from './session-limit.service';
import { EntitlementService } from '../../entitlements/entitlement.service';
import { createMockCache } from '../../../common/testing/cache.mock';
import { hashToken } from '../../../common/utils/hash-token';

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
  let mockUserRepository: {
    update: jest.Mock;
  };
  let mockDataSource: {
    transaction: jest.Mock;
    getRepository: jest.Mock;
  };
  let mockUsersService: {
    findByEmail: jest.Mock;
    findOne: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    incrementFailedAttemptsAndLockIfNeeded: jest.Mock;
    resetLoginAttempts: jest.Mock;
    upgradePasswordHash: jest.Mock;
    setEmailVerificationToken: jest.Mock;
    findByEmailVerificationToken: jest.Mock;
    markEmailVerified: jest.Mock;
    setPasswordResetToken: jest.Mock;
    findByPasswordResetToken: jest.Mock;
    clearPendingEmailChange: jest.Mock;
    update: jest.Mock;
  };
  let mockTokenGenerator: {
    generateTokens: jest.Mock;
  };
  let mockConfigService: {
    get: jest.Mock;
    getOrThrow: jest.Mock;
  };
  let mockRefreshTokenService: {
    createRefreshToken: jest.Mock;
    findByToken: jest.Mock;
    isLostResponseReplay: jest.Mock;
    deleteByUserId: jest.Mock;
    deleteBySessionId: jest.Mock;
    revokeToken: jest.Mock;
    pruneOldestTokens: jest.Mock;
  };
  let mockMailService: {
    sendPasswordChangedNotification: jest.Mock;
    sendEmailVerification: jest.Mock;
    sendPasswordReset: jest.Mock;
    sendEmailChangeConfirmation: jest.Mock;
    sendEmailChangeNotificationOld: jest.Mock;
    sendEmailChangeCompletedNotification: jest.Mock;
  };
  let mockRoleService: {
    findRoleByName: jest.Mock;
  };
  let mockAuditService: {
    log: jest.Mock;
    logFireAndForget: jest.Mock;
  };
  let mockMetricsService: {
    recordAuthEvent: jest.Mock;
  };
  let mockBreachedPasswordService: {
    assertNotBreached: jest.Mock;
  };
  let mockEntitlementService: {
    limitFor: jest.Mock;
  };
  let mockJwtService: {
    sign: jest.Mock;
    verify: jest.Mock;
  };
  let mockMfaService: {
    isValidStepUpCode: jest.Mock;
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
    passwordHashVersion: 2,
    hasPassword: true,
    mfaEnabled: false,
    isActive: true,
    isEmailVerified: true,
    locale: 'en',
    failedLoginAttempts: 0,
    lockedUntil: null,
    emailVerificationToken: null,
    emailVerificationExpiresAt: null,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    pendingEmail: null,
    pendingEmailToken: null,
    pendingEmailExpiresAt: null,
    tokenRevokedAt: null,
    totpSecret: null,
    totpEnabledAt: null,
    totpRecoveryCodes: null,
    totpLastUsedStep: null,
    roles: [mockUserRole],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt: null
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

    mockUserRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 })
    };

    mockDataSource = {
      transaction: jest
        .fn()
        .mockImplementation(
          (callback: (manager: typeof mockManager) => Promise<unknown>) =>
            callback(mockManager)
        ),
      getRepository: jest.fn().mockReturnValue(mockUserRepository)
    };

    mockUsersService = {
      findByEmail: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      incrementFailedAttemptsAndLockIfNeeded: jest.fn().mockResolvedValue({
        failedLoginAttempts: 1,
        lockedUntil: null
      }),
      resetLoginAttempts: jest.fn().mockResolvedValue(undefined),
      upgradePasswordHash: jest.fn().mockResolvedValue(undefined),
      setEmailVerificationToken: jest.fn().mockResolvedValue(undefined),
      findByEmailVerificationToken: jest.fn(),
      markEmailVerified: jest.fn().mockResolvedValue(undefined),
      setPasswordResetToken: jest.fn().mockResolvedValue(undefined),
      findByPasswordResetToken: jest.fn(),
      clearPendingEmailChange: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(mockUser)
    };

    mockTokenGenerator = {
      generateTokens: jest.fn().mockReturnValue({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600
      })
    };

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        const config: Record<string, string> = {
          JWT_EXPIRATION: '3600',
          JWT_REFRESH_EXPIRATION: '604800',
          SESSION_ABSOLUTE_MAX_MS: String(DEFAULT_SESSION_ABSOLUTE_MAX_MS)
        };
        return config[key];
      }),
      getOrThrow: jest.fn().mockImplementation((key: string) => {
        const config: Record<string, string> = {
          JWT_EXPIRATION: '3600',
          JWT_REFRESH_EXPIRATION: '604800',
          SESSION_ABSOLUTE_MAX_MS: String(DEFAULT_SESSION_ABSOLUTE_MAX_MS)
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
      findByToken: jest.fn(),
      isLostResponseReplay: jest.fn().mockResolvedValue(false),
      deleteByUserId: jest.fn().mockResolvedValue(undefined),
      deleteBySessionId: jest.fn().mockResolvedValue(1),
      revokeToken: jest.fn().mockResolvedValue(undefined),
      pruneOldestTokens: jest.fn().mockResolvedValue(undefined)
    };

    mockMailService = {
      sendPasswordChangedNotification: jest.fn().mockResolvedValue(undefined),
      sendEmailVerification: jest.fn().mockResolvedValue(undefined),
      sendPasswordReset: jest.fn().mockResolvedValue(undefined),
      sendEmailChangeConfirmation: jest.fn().mockResolvedValue(undefined),
      sendEmailChangeNotificationOld: jest.fn().mockResolvedValue(undefined),
      sendEmailChangeCompletedNotification: jest
        .fn()
        .mockResolvedValue(undefined)
    };

    mockRoleService = {
      findRoleByName: jest
        .fn()
        .mockResolvedValue({ id: 'role-uuid', name: 'user' })
    };

    mockAuditService = {
      log: jest.fn().mockResolvedValue(undefined),
      logFireAndForget: jest.fn()
    };

    mockMetricsService = {
      recordAuthEvent: jest.fn()
    };

    mockBreachedPasswordService = {
      assertNotBreached: jest.fn().mockResolvedValue(undefined)
    };

    // Free tier by default: no plan-specific allowance, so pruning must fall
    // back to the constant. Individual tests raise or break it.
    mockEntitlementService = {
      limitFor: jest.fn().mockResolvedValue(null)
    };

    mockJwtService = {
      sign: jest.fn(),
      verify: jest.fn()
    };

    mockMfaService = {
      isValidStepUpCode: jest.fn().mockResolvedValue(false)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        SessionIssuerService,
        SessionLimitService,
        { provide: EntitlementService, useValue: mockEntitlementService },
        { provide: DataSource, useValue: mockDataSource },
        { provide: UsersService, useValue: mockUsersService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RefreshTokenService, useValue: mockRefreshTokenService },
        { provide: RoleService, useValue: mockRoleService },
        { provide: TokenGeneratorService, useValue: mockTokenGenerator },
        { provide: MailService, useValue: mockMailService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: JwtService, useValue: mockJwtService },
        {
          provide: BreachedPasswordService,
          useValue: mockBreachedPasswordService
        },
        { provide: MfaService, useValue: mockMfaService },
        { provide: CACHE_MANAGER, useValue: createMockCache() }
      ]
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('the blocklist is never consulted on a verify path', () => {
    it('skips it on login', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await service.validateUser('test@example.com', 'Password1');

      expect(
        mockBreachedPasswordService.assertNotBreached
      ).not.toHaveBeenCalled();
    });

    it('skips it on the current-password step up', async () => {
      mockUsersService.findOne.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await service.assertStepUpForUser(
        'user-1',
        'Password1',
        undefined,
        STEP_UP_OPERATION.PASSWORD_SET
      );

      expect(
        mockBreachedPasswordService.assertNotBreached
      ).not.toHaveBeenCalled();
    });
  });

  describe('validateUser', () => {
    it('compares the pre-hash for a current row and leaves it as it is', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      const compare = jest
        .spyOn(bcrypt, 'compare')
        .mockResolvedValue(true as never);

      await service.validateUser('test@example.com', 'Password1');

      expect(compare).toHaveBeenCalledWith(
        prehashPassword('Password1'),
        mockUser.password
      );
      expect(mockUsersService.upgradePasswordHash).not.toHaveBeenCalled();
    });

    it('upgrades a legacy row after a correct password', async () => {
      const legacyUser = {
        ...mockUser,
        passwordHashVersion: PasswordHashVersion.LEGACY
      };
      mockUsersService.findByEmail.mockResolvedValue(legacyUser);
      const compare = jest
        .spyOn(bcrypt, 'compare')
        .mockResolvedValue(true as never);

      await service.validateUser('test@example.com', 'Password1');

      expect(compare).toHaveBeenCalledWith('Password1', mockUser.password);
      expect(mockUsersService.upgradePasswordHash).toHaveBeenCalledWith(
        legacyUser,
        'Password1'
      );
    });

    it('does not upgrade a legacy row after a wrong password', async () => {
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        passwordHashVersion: PasswordHashVersion.LEGACY
      });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.validateUser('test@example.com', 'wrong')
      ).rejects.toThrow(HttpException);
      expect(mockUsersService.upgradePasswordHash).not.toHaveBeenCalled();
    });

    it('should return the User entity when credentials are valid', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.validateUser('test@example.com', 'password');

      // validateUser now returns the User entity itself; ClassSerializerInterceptor
      // strips @Exclude() / @Expose({ groups }) fields downstream.
      expect(result).toEqual(mockUser);
      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(
        'test@example.com'
      );
    });

    it('should throw HttpException when password does not match', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.validateUser('test@example.com', 'wrong-password')
      ).rejects.toThrow(HttpException);
    });

    it('should throw HttpException when user does not exist', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.validateUser('nonexistent@example.com', 'password')
      ).rejects.toThrow(HttpException);
    });

    it('should throw HttpException when user is inactive', async () => {
      const inactiveUser = { ...mockUser, isActive: false };
      mockUsersService.findByEmail.mockResolvedValue(inactiveUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await expect(
        service.validateUser('test@example.com', 'password')
      ).rejects.toThrow(HttpException);
    });

    it('should throw HttpException when user has no password (OAuth-only)', async () => {
      const oauthUser = { ...mockUser, password: null };
      mockUsersService.findByEmail.mockResolvedValue(oauthUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.validateUser('test@example.com', 'password')
      ).rejects.toThrow(HttpException);
    });

    it('should use dummy hash for timing attack protection when user not found', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      const compareSpy = jest
        .spyOn(bcrypt, 'compare')
        .mockResolvedValue(false as never);

      await expect(
        service.validateUser('nonexistent@example.com', 'password')
      ).rejects.toThrow(HttpException);

      // bcrypt.compare should still be called (with dummy hash) for constant-time behavior
      expect(compareSpy).toHaveBeenCalled();
    });

    it('should use a dummy hash with the same cost as real password hashes', () => {
      // A cost mismatch makes the dummy-compare path measurably faster/slower
      // than the real-hash path, reopening the user-enumeration timing oracle
      const dummyHash = AuthService['DUMMY_HASH'];
      expect(bcrypt.getRounds(dummyHash)).toBe(BCRYPT_SALT_ROUNDS);
    });

    it('should throw 423 when the password is correct and the account is locked', async () => {
      const lockedUser = {
        ...mockUser,
        lockedUntil: new Date(Date.now() + 600000) // 10 min from now
      };
      mockUsersService.findByEmail.mockResolvedValue(lockedUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

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

    it('should not restart the counter while the lock window is open', async () => {
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() + 600000)
      });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await expect(
        service.validateUser('test@example.com', 'password')
      ).rejects.toThrow(HttpException);

      expect(mockUsersService.resetLoginAttempts).not.toHaveBeenCalled();
    });

    // A lock that checks the password answers 423 for the right guess and 401
    // for a wrong one, so it keeps taking guesses while it is open
    it('should answer 423 without checking the password on a locked account', async () => {
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() + 600000)
      });
      const compareSpy = jest
        .spyOn(bcrypt, 'compare')
        .mockClear()
        .mockResolvedValue(false as never);

      try {
        await service.validateUser('test@example.com', 'wrong-password');
        fail('Expected HttpException');
      } catch (error) {
        expect((error as HttpException).getStatus()).toBe(HttpStatus.LOCKED);
      }
      expect(compareSpy).not.toHaveBeenCalled();
    });

    it('should answer 423 without checking the password once the budget is spent', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      mockUsersService.incrementFailedAttemptsAndLockIfNeeded.mockResolvedValue(
        {
          failedLoginAttempts: MAX_FAILED_ATTEMPTS + 1,
          lockedUntil: new Date(Date.now() + 900000)
        }
      );
      const compareSpy = jest
        .spyOn(bcrypt, 'compare')
        .mockClear()
        .mockResolvedValue(true as never);

      try {
        await service.validateUser('test@example.com', 'password');
        fail('Expected HttpException');
      } catch (error) {
        expect((error as HttpException).getStatus()).toBe(HttpStatus.LOCKED);
      }
      expect(compareSpy).not.toHaveBeenCalled();
      expect(mockUsersService.resetLoginAttempts).not.toHaveBeenCalled();
    });

    // A read-then-check lets every request of a concurrent burst be checked
    it('should take the attempt slot before checking the password', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      mockUsersService.incrementFailedAttemptsAndLockIfNeeded.mockResolvedValue(
        {
          failedLoginAttempts: 1,
          lockedUntil: null
        }
      );
      const compareSpy = jest
        .spyOn(bcrypt, 'compare')
        .mockClear()
        .mockResolvedValue(true as never);

      await service.validateUser('test@example.com', 'password');

      const [reservedAt] =
        mockUsersService.incrementFailedAttemptsAndLockIfNeeded.mock
          .invocationCallOrder;
      const [comparedAt] = compareSpy.mock.invocationCallOrder;
      expect(reservedAt).toBeLessThan(comparedAt);
    });

    // Otherwise a locked-out user extends their own window on every retry
    it('should add no strike while the lock window is open', async () => {
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() + 600000)
      });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.validateUser('test@example.com', 'wrong-password')
      ).rejects.toThrow(HttpException);

      expect(
        mockUsersService.incrementFailedAttemptsAndLockIfNeeded
      ).not.toHaveBeenCalled();
    });

    // Regression: an elapsed lockout used to leave failedLoginAttempts at the
    // threshold, so the next wrong password re-locked on a single strike
    it('should restart the counter once the lock window has elapsed', async () => {
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() - 1000)
      });
      mockUsersService.incrementFailedAttemptsAndLockIfNeeded.mockResolvedValue(
        { failedLoginAttempts: 1, lockedUntil: null }
      );
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      try {
        await service.validateUser('test@example.com', 'wrong-password');
        fail('Expected HttpException');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(
          HttpStatus.UNAUTHORIZED
        );
      }

      expect(mockUsersService.resetLoginAttempts).toHaveBeenCalledWith(
        'user-1'
      );
    });

    it('should accept a correct password once the lock window has elapsed', async () => {
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() - 1000)
      });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await expect(
        service.validateUser('test@example.com', 'password')
      ).resolves.toMatchObject({ id: 'user-1' });

      // Once by the expiry branch, once to release the slot the attempt took
      expect(mockUsersService.resetLoginAttempts).toHaveBeenCalledTimes(2);
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
        expect(response).toHaveProperty(
          'errorKey',
          ErrorKeys.AUTH.EMAIL_NOT_VERIFIED
        );
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

    it('should record running failedLoginAttempts in invalid_credentials audit', async () => {
      // failedLoginAttempts is hidden from API responses, so the audit log
      // must carry the running count for ops visibility.
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      mockUsersService.incrementFailedAttemptsAndLockIfNeeded.mockResolvedValue(
        { failedLoginAttempts: 2, lockedUntil: null }
      );
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.validateUser('test@example.com', 'wrong-password')
      ).rejects.toThrow(HttpException);

      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_LOGIN_FAILURE,
          actorEmail: 'test@example.com',
          details: { reason: 'invalid_credentials', failedLoginAttempts: 2 }
        })
      );
    });

    it('should record failedLoginAttempts in account_locked_after_max_attempts audit', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      mockUsersService.incrementFailedAttemptsAndLockIfNeeded.mockResolvedValue(
        {
          failedLoginAttempts: 5,
          lockedUntil: new Date(Date.now() + 900000)
        }
      );
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.validateUser('test@example.com', 'wrong-password')
      ).rejects.toThrow(HttpException);

      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_LOGIN_FAILURE,
          targetId: 'user-1',
          details: {
            reason: 'account_locked_after_max_attempts',
            failedLoginAttempts: 5
          }
        })
      );
    });

    it('should omit failedLoginAttempts in audit when no user matches', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.validateUser('nobody@example.com', 'password')
      ).rejects.toThrow(HttpException);

      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_LOGIN_FAILURE,
          actorEmail: 'nobody@example.com',
          details: { reason: 'invalid_credentials' }
        })
      );
    });

    // Otherwise five correct passwords lock an account that is not verified
    it('should release the slot on a correct password before the verification check', async () => {
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        isEmailVerified: false
      });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await expect(
        service.validateUser('test@example.com', 'password')
      ).rejects.toThrow(HttpException);

      expect(mockUsersService.resetLoginAttempts).toHaveBeenCalledWith(
        'user-1'
      );
    });
  });

  describe('login', () => {
    it('should create a new session token and prune oldest beyond limit', async () => {
      const result = await service.login(mockUser, 'Mozilla/5.0 Test');

      expect(mockRefreshTokenService.deleteByUserId).not.toHaveBeenCalled();
      expect(mockRefreshTokenService.createRefreshToken).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
        604800,
        expect.any(String),
        'Mozilla/5.0 Test'
      );
      expect(mockRefreshTokenService.pruneOldestTokens).toHaveBeenCalledWith(
        'user-1',
        MAX_CONCURRENT_SESSIONS
      );
      expect(result.tokens.access_token).toBe('mock-access-token');
      expect(typeof result.tokens.refresh_token).toBe('string');
      expect(result.tokens.expires_in).toBe(3600);
      // Login must return roles as RoleResponse[] objects, NOT as string[]
      // of role names — the client relies on this shape to render the admin
      // badge correctly immediately after login.
      // Login returns the User entity passed in; ClassSerializerInterceptor
      // strips @Exclude() / @Expose({ groups }) fields downstream at the
      // controller boundary.
      expect(result.user).toEqual(mockUser);
      expect(result.user.roles).toEqual([mockUserRole]);
    });

    it('prunes to the plan allowance when the plan carries a sessions limit', async () => {
      mockEntitlementService.limitFor.mockResolvedValue(10);

      await service.login(mockUser, null);

      expect(mockEntitlementService.limitFor).toHaveBeenCalledWith(
        'user-1',
        'sessions'
      );
      expect(mockRefreshTokenService.pruneOldestTokens).toHaveBeenCalledWith(
        'user-1',
        10
      );
    });

    it('still logs in on the default allowance when entitlement resolution throws', async () => {
      mockEntitlementService.limitFor.mockRejectedValue(
        new Error('billing unavailable')
      );

      // A billing outage must never become a login outage.
      const result = await service.login(mockUser, null);

      expect(result.tokens.access_token).toBe('mock-access-token');
      expect(mockRefreshTokenService.pruneOldestTokens).toHaveBeenCalledWith(
        'user-1',
        MAX_CONCURRENT_SESSIONS
      );
    });

    it('should throw when config values are missing', async () => {
      mockConfigService.getOrThrow.mockImplementation((key: string) => {
        throw new Error(`Configuration key "${key}" does not exist`);
      });

      await expect(service.login(mockUser, null)).rejects.toThrow(
        'Configuration key "JWT_REFRESH_EXPIRATION" does not exist'
      );
    });

    it('should generate tokens with correct payload', async () => {
      await service.login(mockUser, null);

      // JWT payload keeps role names as string[] (CASL / storage contract),
      // even though the response body carries RoleResponse[] objects.
      expect(mockTokenGenerator.generateTokens).toHaveBeenCalledWith(
        'user-1',
        'test@example.com',
        ['user'],
        expect.any(String)
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
        expect.any(String),
        'en'
      );
      expect(result.message).toContain('Registration successful');
    });

    it('should throw HttpException when email already exists', async () => {
      mockManager.findOne.mockResolvedValue(mockUser); // conflict

      await expect(service.register(registerDto)).rejects.toThrow(
        HttpException
      );
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('refuses a breached password before it opens the transaction', async () => {
      mockBreachedPasswordService.assertNotBreached.mockRejectedValue(
        new HttpException(
          { message: 'breached', errorKey: ErrorKeys.AUTH.PASSWORD_BREACHED },
          HttpStatus.BAD_REQUEST
        )
      );

      await expect(service.register(registerDto)).rejects.toMatchObject({
        response: { errorKey: ErrorKeys.AUTH.PASSWORD_BREACHED }
      });
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('accepts a password made only of lower-case letters', async () => {
      mockManager.findOne.mockResolvedValue(null);
      mockManager.save.mockResolvedValue(savedUser);

      const result = await service.register({
        ...registerDto,
        password: 'kettlesunrise'
      });

      expect(result.message).toContain('Registration successful');
      expect(
        mockBreachedPasswordService.assertNotBreached
      ).toHaveBeenCalledWith(
        'kettlesunrise',
        expect.objectContaining({
          email: registerDto.email,
          firstName: registerDto.firstName,
          lastName: registerDto.lastName
        })
      );
    });

    it('translates a unique violation on the insert into the same 409', async () => {
      mockManager.findOne.mockResolvedValue(null); // check passes
      mockManager.save.mockRejectedValue({ code: '23505' }); // index rejects

      try {
        await service.register(registerDto);
        fail('Expected HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
        expect((err as HttpException).getResponse()).toEqual(
          expect.objectContaining({ errorKey: ErrorKeys.USERS.EMAIL_EXISTS })
        );
      }
    });

    it('propagates unrelated database failures from the insert', async () => {
      mockManager.findOne.mockResolvedValue(null);
      mockManager.save.mockRejectedValue(new Error('connection lost'));

      await expect(service.register(registerDto)).rejects.toThrow(
        'connection lost'
      );
    });

    it('audits the conflict raised by the pre-check', async () => {
      mockManager.findOne.mockResolvedValue(mockUser);

      await expect(
        service.register(registerDto, { ip: '10.0.0.1', requestId: 'req-1' })
      ).rejects.toThrow(HttpException);

      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith({
        action: AuditAction.USER_REGISTER_CONFLICT,
        actorEmail: 'new@example.com',
        context: { ip: '10.0.0.1', requestId: 'req-1' }
      });
      expect(mockAuditService.log).not.toHaveBeenCalled();
    });

    it('audits the conflict raised by the unique violation on the insert', async () => {
      mockManager.findOne.mockResolvedValue(null);
      mockManager.save.mockRejectedValue({ code: '23505' });

      await expect(service.register(registerDto)).rejects.toThrow(
        HttpException
      );

      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_REGISTER_CONFLICT,
          actorEmail: 'new@example.com'
        })
      );
      expect(mockAuditService.log).not.toHaveBeenCalled();
    });

    it('does not audit a conflict when the failure is unrelated', async () => {
      mockManager.findOne.mockResolvedValue(null);
      mockManager.save.mockRejectedValue(new Error('connection lost'));

      await expect(service.register(registerDto)).rejects.toThrow(
        'connection lost'
      );

      expect(mockAuditService.logFireAndForget).not.toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_REGISTER_CONFLICT
        })
      );
    });

    it('audits the success path and never the conflict', async () => {
      mockManager.findOne.mockResolvedValue(null);
      mockManager.save.mockResolvedValue(savedUser);

      await service.register(registerDto);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.USER_REGISTER })
      );
      expect(mockAuditService.logFireAndForget).not.toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_REGISTER_CONFLICT
        })
      );
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

    it('should issue no token and send no mail for a deactivated account', async () => {
      const deactivatedUser = {
        ...mockUser,
        isEmailVerified: false,
        isActive: false
      };
      mockUsersService.findByEmail.mockResolvedValue(deactivatedUser);

      const result = await service.resendVerificationEmail('test@example.com');

      expect(mockUsersService.setEmailVerificationToken).not.toHaveBeenCalled();
      expect(mockMailService.sendEmailVerification).not.toHaveBeenCalled();
      expect(result.message).toBeDefined();
    });

    it('should answer a deactivated account exactly like an unknown address', async () => {
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        isEmailVerified: false,
        isActive: false
      });
      const deactivated =
        await service.resendVerificationEmail('test@example.com');

      mockUsersService.findByEmail.mockResolvedValue(null);
      const unknown = await service.resendVerificationEmail(
        'nonexistent@example.com'
      );

      expect(deactivated).toEqual(unknown);
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
        expect.any(String),
        'en'
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
    it('refuses a breached password after the token clears', async () => {
      mockUsersService.findByPasswordResetToken.mockResolvedValue({
        ...mockUser,
        passwordResetExpiresAt: new Date(Date.now() + 3600000)
      });
      mockBreachedPasswordService.assertNotBreached.mockRejectedValue(
        new HttpException(
          { message: 'breached', errorKey: ErrorKeys.AUTH.PASSWORD_BREACHED },
          HttpStatus.BAD_REQUEST
        )
      );

      await expect(
        service.resetPassword('valid-token', 'Password1')
      ).rejects.toMatchObject({
        response: { errorKey: ErrorKeys.AUTH.PASSWORD_BREACHED }
      });
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('spends no lookup on an invalid token', async () => {
      mockUsersService.findByPasswordResetToken.mockResolvedValue(null);

      await expect(
        service.resetPassword('bad-token', 'Password1')
      ).rejects.toThrow(HttpException);
      expect(
        mockBreachedPasswordService.assertNotBreached
      ).not.toHaveBeenCalled();
    });

    // A stolen reset link produces a completed takeover that the audit trail
    // alone never shows the owner, so the completion has to notify.
    it('should notify the account owner that the password was reset', async () => {
      mockUsersService.findByPasswordResetToken.mockResolvedValue({
        ...mockUser,
        passwordResetExpiresAt: new Date(Date.now() + 3600000)
      });

      await service.resetPassword('valid-token', 'NewPassword1', {
        ip: '198.51.100.7'
      });

      expect(
        mockMailService.sendPasswordChangedNotification
      ).toHaveBeenCalledWith('test@example.com', 'reset', 'en', '198.51.100.7');
    });

    it('should complete the reset when the notification fails', async () => {
      const loggerError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      mockMailService.sendPasswordChangedNotification.mockRejectedValueOnce(
        new Error('smtp down')
      );
      mockUsersService.findByPasswordResetToken.mockResolvedValue({
        ...mockUser,
        passwordResetExpiresAt: new Date(Date.now() + 3600000)
      });

      const result = await service.resetPassword('valid-token', 'NewPassword1');
      await new Promise((resolve) => setImmediate(resolve));

      expect(result.message).toContain('reset successfully');
      expect(loggerError).toHaveBeenCalled();
    });

    it('should reset password, clear token, and invalidate sessions atomically', async () => {
      const user = {
        ...mockUser,
        passwordResetExpiresAt: new Date(Date.now() + 3600000)
      };
      mockUsersService.findByPasswordResetToken.mockResolvedValue(user);

      const result = await service.resetPassword('valid-token', 'NewPassword1');

      expect(mockDataSource.transaction).toHaveBeenCalled();
      // Password update + token clear + session revocation in one manager.update call
      expect(mockManager.update).toHaveBeenCalledWith(
        expect.anything(), // User entity class
        { id: 'user-1', passwordResetToken: hashToken('valid-token') },
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          password: expect.any(String), // bcrypt hash
          passwordResetToken: null,
          passwordResetExpiresAt: null,
          pendingEmail: null,
          pendingEmailToken: null,
          pendingEmailExpiresAt: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          tokenRevokedAt: expect.any(Date)
        })
      );
      // Session invalidation
      expect(mockManager.delete).toHaveBeenCalledWith(
        expect.anything(), // RefreshToken entity class
        { userId: 'user-1' }
      );
      expect(result.message).toContain('reset successfully');
    });

    // Regression: the reset left the lockout standing, so the user was
    // answered 423 with the password they had just set
    it('should clear an active lockout for the account it resets', async () => {
      mockUsersService.findByPasswordResetToken.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() + 900000),
        passwordResetExpiresAt: new Date(Date.now() + 3600000)
      });

      await service.resetPassword('valid-token', 'NewPassword1');

      expect(mockManager.update).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'user-1', passwordResetToken: hashToken('valid-token') },
        expect.objectContaining({ failedLoginAttempts: 0, lockedUntil: null })
      );
    });

    // Regression: redeeming the token proves mailbox control, but the flag
    // stayed false, so an unverified account was answered 403 after recovery
    it('should mark the email verified for the account it resets', async () => {
      mockUsersService.findByPasswordResetToken.mockResolvedValue({
        ...mockUser,
        isEmailVerified: false,
        password: null,
        passwordResetExpiresAt: new Date(Date.now() + 3600000)
      });

      await service.resetPassword('valid-token', 'NewPassword1');

      expect(mockManager.update).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'user-1', passwordResetToken: hashToken('valid-token') },
        expect.objectContaining({ isEmailVerified: true })
      );
    });

    // Regression: the write was keyed on the id only, so a password change
    // that landed during the breach lookup was overwritten by the stale reset
    it('should refuse the reset when the token was cleared after the lookup', async () => {
      mockUsersService.findByPasswordResetToken.mockResolvedValue({
        ...mockUser,
        passwordResetExpiresAt: new Date(Date.now() + 3600000)
      });
      mockManager.update.mockResolvedValueOnce({ affected: 0 });

      await expect(
        service.resetPassword('valid-token', 'NewPassword1')
      ).rejects.toMatchObject({
        response: { errorKey: ErrorKeys.AUTH.INVALID_RESET_TOKEN }
      });
      expect(mockManager.delete).not.toHaveBeenCalled();
      expect(mockAuditService.log).not.toHaveBeenCalled();
      expect(
        mockMailService.sendPasswordChangedNotification
      ).not.toHaveBeenCalled();
    });

    it('should throw 400 when token not found', async () => {
      mockUsersService.findByPasswordResetToken.mockResolvedValue(null);

      await expect(
        service.resetPassword('invalid-token', 'NewPassword1')
      ).rejects.toThrow(HttpException);
    });

    // Regression: forgotPassword already refuses deactivated accounts, but a
    // token issued while the account was still active stayed redeemable
    it('should reject a still-valid token once the account is deactivated', async () => {
      mockUsersService.findByPasswordResetToken.mockResolvedValue({
        ...mockUser,
        isActive: false,
        passwordResetExpiresAt: new Date(Date.now() + 3600000)
      });

      await expect(
        service.resetPassword('valid-token', 'NewPassword1')
      ).rejects.toMatchObject({
        response: { errorKey: ErrorKeys.AUTH.INVALID_RESET_TOKEN }
      });
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
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

  describe('logoutSession', () => {
    const sessionRow = {
      id: 'token-1',
      userId: 'user-1',
      sessionId: 'session-1',
      revoked: false
    };

    it('ends only the session the presented token belongs to', async () => {
      mockRefreshTokenService.findByToken.mockResolvedValue(sessionRow);

      const ended = await service.logoutSession('user-1', 'raw-token');

      expect(ended).toBe(true);
      expect(mockRefreshTokenService.deleteBySessionId).toHaveBeenCalledWith(
        'session-1'
      );
      // The two that would take every other device down with it.
      expect(mockRefreshTokenService.deleteByUserId).not.toHaveBeenCalled();
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });

    it('revokes nothing when the request carries no refresh token', async () => {
      const ended = await service.logoutSession('user-1', undefined);

      expect(ended).toBe(false);
      expect(mockRefreshTokenService.findByToken).not.toHaveBeenCalled();
      expect(mockRefreshTokenService.deleteBySessionId).not.toHaveBeenCalled();
      expect(mockRefreshTokenService.deleteByUserId).not.toHaveBeenCalled();
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });

    it('revokes nothing when the token resolves to no row', async () => {
      mockRefreshTokenService.findByToken.mockResolvedValue(null);

      const ended = await service.logoutSession('user-1', 'stale-token');

      expect(ended).toBe(false);
      expect(mockRefreshTokenService.deleteBySessionId).not.toHaveBeenCalled();
    });

    it('refuses a token owned by another account', async () => {
      mockRefreshTokenService.findByToken.mockResolvedValue({
        ...sessionRow,
        userId: 'user-2'
      });

      const ended = await service.logoutSession('user-1', 'someone-elses');

      expect(ended).toBe(false);
      expect(mockRefreshTokenService.deleteBySessionId).not.toHaveBeenCalled();
    });

    it('reports no session ended when the row was already gone', async () => {
      mockRefreshTokenService.findByToken.mockResolvedValue(sessionRow);
      mockRefreshTokenService.deleteBySessionId.mockResolvedValue(0);

      const ended = await service.logoutSession('user-1', 'raw-token');

      expect(ended).toBe(false);
    });
  });

  describe('endPresentedSession', () => {
    it('ends only the session the presented token belongs to', async () => {
      mockRefreshTokenService.findByToken.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        sessionId: 'session-1',
        revoked: false
      });

      await service.endPresentedSession('raw-token');

      expect(mockRefreshTokenService.deleteBySessionId).toHaveBeenCalledWith(
        'session-1'
      );
      expect(mockRefreshTokenService.deleteByUserId).not.toHaveBeenCalled();
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });

    // The browser replaces the cookie whichever account signs in, so the
    // owner check that protects the logout route does not apply here.
    it('ends the session whatever account owns it', async () => {
      mockRefreshTokenService.findByToken.mockResolvedValue({
        id: 'token-2',
        userId: 'user-2',
        sessionId: 'session-2',
        revoked: false
      });

      await service.endPresentedSession('other-account-token');

      expect(mockRefreshTokenService.deleteBySessionId).toHaveBeenCalledWith(
        'session-2'
      );
    });

    it('does nothing when the request carries no refresh token', async () => {
      await service.endPresentedSession(undefined);

      expect(mockRefreshTokenService.findByToken).not.toHaveBeenCalled();
      expect(mockRefreshTokenService.deleteBySessionId).not.toHaveBeenCalled();
    });

    it('does nothing when the token resolves to no row', async () => {
      mockRefreshTokenService.findByToken.mockResolvedValue(null);

      await service.endPresentedSession('stale-token');

      expect(mockRefreshTokenService.deleteBySessionId).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllUserSessions', () => {
    it('should delete all refresh tokens and set tokenRevokedAt', async () => {
      await service.revokeAllUserSessions('user-1');

      expect(mockRefreshTokenService.deleteByUserId).toHaveBeenCalledWith(
        'user-1'
      );
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        'user-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ tokenRevokedAt: expect.any(Date) })
      );
    });
  });

  describe('refreshTokens', () => {
    const mockTokenDoc = {
      id: 'token-1',
      token: 'hashed-token',
      userId: 'user-1',
      sessionId: 'session-1',
      sessionStartedAt: new Date(Date.now() - 3600000),
      revoked: false,
      expiresAt: new Date(Date.now() + 86400000),
      isExpired: () => false
    };

    it('should issue new tokens and revoke old token atomically', async () => {
      mockRefreshTokenService.findByToken.mockResolvedValue(mockTokenDoc);
      mockUsersService.findById.mockResolvedValue(mockUser);

      const result = await service.refreshTokens('valid-refresh-token');

      expect(mockRefreshTokenService.findByToken).toHaveBeenCalledWith(
        'valid-refresh-token'
      );
      // Revoke + create happen inside a transaction via manager
      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(mockManager.update).toHaveBeenCalled();
      expect(mockManager.save).toHaveBeenCalled();
      // Rotation replaces a row inside one session. A new session id here would
      // strand the access token every other tab of this device still holds.
      expect(mockManager.save).toHaveBeenCalledWith(
        RefreshToken,
        expect.objectContaining({ sessionId: 'session-1' })
      );
      expect(mockTokenGenerator.generateTokens).toHaveBeenCalledWith(
        'user-1',
        'test@example.com',
        ['user'],
        'session-1'
      );
      expect(result.tokens.access_token).toBe('mock-access-token');
      expect(typeof result.tokens.refresh_token).toBe('string');
      expect(result.tokens.expires_in).toBe(3600);
      // Refresh must return roles as RoleResponse[] objects, not string[].
      expect(result.user).toEqual(
        expect.objectContaining({
          id: 'user-1',
          email: 'test@example.com',
          roles: [mockUserRole]
        })
      );
    });

    it('should return the User entity instance so @Exclude() fields can be stripped downstream', async () => {
      // hasPassword is a get-only accessor on User, so it must not travel in
      // the source of an Object.assign onto a real instance.
      const {
        hasPassword: _derived,
        mfaEnabled: _derivedMfa,
        ...columns
      } = mockUser;
      const entity = Object.assign(new User(), columns, {
        passwordResetToken: 'hashed-reset-token'
      });
      mockRefreshTokenService.findByToken.mockResolvedValue(mockTokenDoc);
      mockUsersService.findById.mockResolvedValue(entity);

      const result = await service.refreshTokens('valid-refresh-token');

      expect(result.user).toBe(entity);
      expect(instanceToPlain(result.user)).not.toHaveProperty(
        'passwordResetToken'
      );
    });

    it('should throw HttpException when token not found', async () => {
      mockRefreshTokenService.findByToken.mockResolvedValue(null);

      await expect(service.refreshTokens('invalid-token')).rejects.toThrow(
        HttpException
      );
    });

    it('should throw HttpException when token is revoked', async () => {
      const revokedToken = { ...mockTokenDoc, revoked: true };
      mockRefreshTokenService.findByToken.mockResolvedValue(revokedToken);

      await expect(service.refreshTokens('revoked-token')).rejects.toThrow(
        HttpException
      );
    });

    describe('reuse detection', () => {
      it('should revoke ALL user sessions, audit and meter on revoked-but-not-expired token', async () => {
        // OAuth 2.0 BCP: a revoked token presented before its natural expiry
        // signals possible compromise — kill the whole session for the user.
        const revokedToken = {
          ...mockTokenDoc,
          revoked: true,
          isExpired: () => false
        };
        mockRefreshTokenService.findByToken.mockResolvedValue(revokedToken);

        await expect(service.refreshTokens('reused-token')).rejects.toThrow(
          HttpException
        );

        expect(mockRefreshTokenService.deleteByUserId).toHaveBeenCalledWith(
          'user-1'
        );
        expect(mockUserRepository.update).toHaveBeenCalledWith(
          'user-1',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          expect.objectContaining({ tokenRevokedAt: expect.any(Date) })
        );
        expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
          expect.objectContaining({
            action: AuditAction.TOKEN_REUSE_DETECTED,
            actorId: 'user-1',
            targetId: 'user-1',
            targetType: 'User',
            details: { tokenId: 'token-1' }
          })
        );
        expect(mockMetricsService.recordAuthEvent).toHaveBeenCalledWith(
          'token_reuse_detected'
        );
      });

      it('ends only the presented session when the replay is a lost rotation response', async () => {
        const revokedToken = {
          ...mockTokenDoc,
          revoked: true,
          isExpired: () => false
        };
        mockRefreshTokenService.findByToken.mockResolvedValue(revokedToken);
        mockRefreshTokenService.isLostResponseReplay.mockResolvedValue(true);

        await expect(
          service.refreshTokens('replayed-token')
        ).rejects.toMatchObject({
          status: HttpStatus.UNAUTHORIZED,
          response: { errorKey: ErrorKeys.AUTH.INVALID_REFRESH_TOKEN }
        });

        expect(
          mockRefreshTokenService.isLostResponseReplay
        ).toHaveBeenCalledWith(revokedToken, REFRESH_REUSE_GRACE_MS);
        expect(mockRefreshTokenService.deleteBySessionId).toHaveBeenCalledWith(
          'session-1'
        );
        expect(mockRefreshTokenService.deleteByUserId).not.toHaveBeenCalled();
        expect(mockUserRepository.update).not.toHaveBeenCalled();
        expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith({
          action: AuditAction.TOKEN_REFRESH_FAILURE,
          actorId: 'user-1',
          details: { reason: 'predecessor_replay_in_grace' }
        });
        expect(mockAuditService.logFireAndForget).not.toHaveBeenCalledWith(
          expect.objectContaining({ action: AuditAction.TOKEN_REUSE_DETECTED })
        );
        expect(mockMetricsService.recordAuthEvent).toHaveBeenCalledWith(
          'token_refresh_failure'
        );
        expect(mockMetricsService.recordAuthEvent).not.toHaveBeenCalledWith(
          'token_reuse_detected'
        );
      });

      it('should fall through to plain failure for revoked AND expired tokens', async () => {
        // Expired-and-revoked is the natural cleanup path; do not panic-revoke
        // the user's other sessions in that case.
        const revokedExpired = {
          ...mockTokenDoc,
          revoked: true,
          isExpired: () => true
        };
        mockRefreshTokenService.findByToken.mockResolvedValue(revokedExpired);

        await expect(service.refreshTokens('stale-token')).rejects.toThrow(
          HttpException
        );

        expect(mockRefreshTokenService.deleteByUserId).not.toHaveBeenCalled();
        expect(mockUserRepository.update).not.toHaveBeenCalled();
        expect(mockAuditService.logFireAndForget).not.toHaveBeenCalledWith(
          expect.objectContaining({ action: AuditAction.TOKEN_REUSE_DETECTED })
        );
        expect(mockMetricsService.recordAuthEvent).toHaveBeenCalledWith(
          'token_refresh_failure'
        );
      });

      it('should kill all sessions when the SAME original token is presented twice', async () => {
        // First refresh — happy path, rotates the token.
        mockRefreshTokenService.findByToken.mockResolvedValueOnce(mockTokenDoc);
        mockUsersService.findById.mockResolvedValue(mockUser);

        const first = await service.refreshTokens('original-token');
        expect(first.tokens.access_token).toBe('mock-access-token');

        // Second refresh with the SAME original token — service now sees it as
        // revoked-but-not-yet-expired, triggering reuse detection.
        const revokedNow = {
          ...mockTokenDoc,
          revoked: true,
          isExpired: () => false
        };
        mockRefreshTokenService.findByToken.mockResolvedValueOnce(revokedNow);

        await expect(service.refreshTokens('original-token')).rejects.toThrow(
          HttpException
        );

        expect(mockRefreshTokenService.deleteByUserId).toHaveBeenCalledWith(
          'user-1'
        );
        expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
          expect.objectContaining({
            action: AuditAction.TOKEN_REUSE_DETECTED
          })
        );
      });
    });

    it('should throw HttpException when token is expired', async () => {
      const expiredToken = { ...mockTokenDoc, isExpired: () => true };
      mockRefreshTokenService.findByToken.mockResolvedValue(expiredToken);

      await expect(service.refreshTokens('expired-token')).rejects.toThrow(
        HttpException
      );
    });

    // A token path answers 401, never the 404 of the users API: the account
    // behind a live refresh row can be soft-deleted before its session is.
    it('answers 401 USER_NOT_FOUND when the account behind the token is gone', async () => {
      mockRefreshTokenService.findByToken.mockResolvedValue(mockTokenDoc);
      mockUsersService.findById.mockResolvedValue(null);

      const error = await service
        .refreshTokens('valid-refresh-token')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(401);
      expect((error as HttpException).getResponse()).toEqual(
        expect.objectContaining({ errorKey: ErrorKeys.AUTH.USER_NOT_FOUND })
      );
      expect(mockUsersService.findById).toHaveBeenCalledWith('user-1');
    });

    it('should revoke token and throw when user is deactivated', async () => {
      const inactiveUser = { ...mockUser, isActive: false };
      mockRefreshTokenService.findByToken.mockResolvedValue(mockTokenDoc);
      mockUsersService.findById.mockResolvedValue(inactiveUser);

      await expect(
        service.refreshTokens('valid-refresh-token')
      ).rejects.toThrow(HttpException);

      expect(mockRefreshTokenService.revokeToken).toHaveBeenCalledWith(
        'token-1'
      );
    });

    it('ends the session and throws when JWT_MIN_IAT is set and token was created before it', async () => {
      const oldToken = {
        ...mockTokenDoc,
        createdAt: new Date('2024-01-01T00:00:00Z')
      };
      mockRefreshTokenService.findByToken.mockResolvedValue(oldToken);
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'JWT_MIN_IAT') return 1800000000; // 2027, after oldToken.createdAt
        const config: Record<string, string> = {
          JWT_EXPIRATION: '3600',
          JWT_REFRESH_EXPIRATION: '604800'
        };
        return config[key];
      });

      await expect(service.refreshTokens('old-session-token')).rejects.toThrow(
        HttpException
      );

      expect(mockRefreshTokenService.deleteBySessionId).toHaveBeenCalledWith(
        'session-1'
      );
      expect(mockRefreshTokenService.revokeToken).not.toHaveBeenCalled();
    });

    it('refuses a refresh past the absolute session lifetime and ends the session', async () => {
      const agedToken = {
        ...mockTokenDoc,
        sessionStartedAt: new Date(
          Date.now() - DEFAULT_SESSION_ABSOLUTE_MAX_MS - 1000
        )
      };
      mockRefreshTokenService.findByToken.mockResolvedValue(agedToken);
      mockUsersService.findById.mockResolvedValue(mockUser);

      await expect(
        service.refreshTokens('aged-session-token')
      ).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
        response: { errorKey: ErrorKeys.AUTH.SESSION_EXPIRED }
      });

      expect(mockRefreshTokenService.deleteBySessionId).toHaveBeenCalledWith(
        'session-1'
      );
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('carries the session start and the device over a rotation inside the cap', async () => {
      const startedAt = new Date(
        Date.now() - DEFAULT_SESSION_ABSOLUTE_MAX_MS / 2
      );
      mockRefreshTokenService.findByToken.mockResolvedValue({
        ...mockTokenDoc,
        sessionStartedAt: startedAt,
        userAgent: 'Mozilla/5.0 Test'
      });
      mockUsersService.findById.mockResolvedValue(mockUser);

      await service.refreshTokens('valid-refresh-token');

      expect(mockManager.save).toHaveBeenCalledWith(
        RefreshToken,
        expect.objectContaining({
          sessionId: 'session-1',
          sessionStartedAt: startedAt,
          userAgent: 'Mozilla/5.0 Test'
        })
      );
      expect(mockRefreshTokenService.deleteBySessionId).not.toHaveBeenCalled();
    });

    it('rotates an aged session when SESSION_ABSOLUTE_MAX_MS is 0', async () => {
      mockConfigService.getOrThrow.mockImplementation((key: string) => {
        const config: Record<string, string> = {
          JWT_EXPIRATION: '3600',
          JWT_REFRESH_EXPIRATION: '604800',
          SESSION_ABSOLUTE_MAX_MS: '0'
        };
        const value = config[key];
        if (value === undefined) {
          throw new Error(`Configuration key "${key}" does not exist`);
        }
        return value;
      });
      mockRefreshTokenService.findByToken.mockResolvedValue({
        ...mockTokenDoc,
        sessionStartedAt: new Date(2020, 0, 1)
      });
      mockUsersService.findById.mockResolvedValue(mockUser);

      const result = await service.refreshTokens('valid-refresh-token');

      expect(result.tokens.access_token).toBe('mock-access-token');
      expect(mockRefreshTokenService.deleteBySessionId).not.toHaveBeenCalled();
    });

    it('should allow refresh when JWT_MIN_IAT is set and token was created after it', async () => {
      const recentToken = {
        ...mockTokenDoc,
        createdAt: new Date('2030-01-01T00:00:00Z')
      };
      mockRefreshTokenService.findByToken.mockResolvedValue(recentToken);
      mockUsersService.findById.mockResolvedValue(mockUser);
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'JWT_MIN_IAT') return 1800000000; // 2027, before recentToken.createdAt
        const config: Record<string, string> = {
          JWT_EXPIRATION: '3600',
          JWT_REFRESH_EXPIRATION: '604800'
        };
        return config[key];
      });

      const result = await service.refreshTokens('valid-refresh-token');

      expect(result.tokens.access_token).toBe('mock-access-token');
    });
  });

  describe('assertStepUpForUser', () => {
    it('upgrades a legacy row after a correct current password', async () => {
      const legacyUser = {
        ...mockUser,
        passwordHashVersion: PasswordHashVersion.LEGACY
      };
      mockUsersService.findOne.mockResolvedValue(legacyUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await service.assertStepUpForUser(
        mockUser.id,
        'CurrentPass1',
        undefined,
        STEP_UP_OPERATION.PASSWORD_SET
      );

      expect(mockUsersService.upgradePasswordHash).toHaveBeenCalledWith(
        legacyUser,
        'CurrentPass1'
      );
    });

    it('should resolve when bcrypt.compare succeeds', async () => {
      mockUsersService.findOne.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await expect(
        service.assertStepUpForUser(
          mockUser.id,
          'CurrentPass1',
          undefined,
          STEP_UP_OPERATION.PASSWORD_SET
        )
      ).resolves.toBeUndefined();
    });

    it('should throw 400 with INVALID_CURRENT_PASSWORD when bcrypt.compare fails', async () => {
      mockUsersService.findOne.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.assertStepUpForUser(
          mockUser.id,
          'WrongPass1',
          undefined,
          STEP_UP_OPERATION.PASSWORD_SET
        )
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: { errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD }
      });
    });

    it('should throw INVALID_CURRENT_PASSWORD when currentPassword is undefined and user has a password', async () => {
      mockUsersService.findOne.mockResolvedValue(mockUser);

      await expect(
        service.assertStepUpForUser(
          mockUser.id,
          undefined,
          undefined,
          STEP_UP_OPERATION.PASSWORD_SET
        )
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: { errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD }
      });
    });

    it('demands a provider proof when the account holds no password', async () => {
      const oauthOnlyUser = { ...mockUser, password: null };
      mockUsersService.findOne.mockResolvedValue(oauthOnlyUser);
      const compareSpy = jest.spyOn(bcrypt, 'compare');
      compareSpy.mockClear();

      await expect(
        service.assertStepUpForUser(
          oauthOnlyUser.id,
          undefined,
          undefined,
          STEP_UP_OPERATION.PASSWORD_SET
        )
      ).rejects.toMatchObject({
        response: { errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED }
      });
      expect(compareSpy).not.toHaveBeenCalled();
    });

    it('accepts a proof minted for this operation', async () => {
      const oauthOnlyUser = { ...mockUser, password: null };
      mockUsersService.findOne.mockResolvedValue(oauthOnlyUser);
      mockJwtService.verify.mockReturnValue({
        sub: oauthOnlyUser.id,
        purpose: TOKEN_PURPOSE.REAUTH_PROOF,
        operation: STEP_UP_OPERATION.PASSWORD_SET,
        iat: Math.floor(Date.now() / 1000),
        jti: 'proof-1'
      });

      await expect(
        service.assertStepUpForUser(
          oauthOnlyUser.id,
          undefined,
          'proof',
          STEP_UP_OPERATION.PASSWORD_SET
        )
      ).resolves.toBeUndefined();
    });

    it('refuses the same proof a second time', async () => {
      const oauthOnlyUser = { ...mockUser, password: null };
      mockUsersService.findOne.mockResolvedValue(oauthOnlyUser);
      mockJwtService.verify.mockReturnValue({
        sub: oauthOnlyUser.id,
        purpose: TOKEN_PURPOSE.REAUTH_PROOF,
        operation: STEP_UP_OPERATION.PASSWORD_SET,
        iat: Math.floor(Date.now() / 1000),
        jti: 'proof-replayed'
      });

      await expect(
        service.assertStepUpForUser(
          oauthOnlyUser.id,
          undefined,
          'proof',
          STEP_UP_OPERATION.PASSWORD_SET
        )
      ).resolves.toBeUndefined();

      // The account holds no password, so a refused proof must not fall
      // through to the password branch.
      await expect(
        service.assertStepUpForUser(
          oauthOnlyUser.id,
          undefined,
          'proof',
          STEP_UP_OPERATION.PASSWORD_SET
        )
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: { errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED }
      });
    });

    it('refuses a proof that carries no token id', async () => {
      const oauthOnlyUser = { ...mockUser, password: null };
      mockUsersService.findOne.mockResolvedValue(oauthOnlyUser);
      mockJwtService.verify.mockReturnValue({
        sub: oauthOnlyUser.id,
        purpose: TOKEN_PURPOSE.REAUTH_PROOF,
        operation: STEP_UP_OPERATION.PASSWORD_SET,
        iat: Math.floor(Date.now() / 1000)
      });

      await expect(
        service.assertStepUpForUser(
          oauthOnlyUser.id,
          undefined,
          'proof',
          STEP_UP_OPERATION.PASSWORD_SET
        )
      ).rejects.toMatchObject({
        response: { errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED }
      });
    });

    it('does not spend the proof when the operation does not match', async () => {
      const oauthOnlyUser = { ...mockUser, password: null };
      mockUsersService.findOne.mockResolvedValue(oauthOnlyUser);
      mockJwtService.verify.mockReturnValue({
        sub: oauthOnlyUser.id,
        purpose: TOKEN_PURPOSE.REAUTH_PROOF,
        operation: STEP_UP_OPERATION.PASSWORD_SET,
        iat: Math.floor(Date.now() / 1000),
        jti: 'proof-unspent'
      });

      await expect(
        service.assertStepUpForUser(
          oauthOnlyUser.id,
          undefined,
          'proof',
          STEP_UP_OPERATION.EMAIL_CHANGE
        )
      ).rejects.toMatchObject({
        response: { errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED }
      });

      await expect(
        service.assertStepUpForUser(
          oauthOnlyUser.id,
          undefined,
          'proof',
          STEP_UP_OPERATION.PASSWORD_SET
        )
      ).resolves.toBeUndefined();
    });

    it('refuses a proof minted for another operation', async () => {
      const oauthOnlyUser = { ...mockUser, password: null };
      mockUsersService.findOne.mockResolvedValue(oauthOnlyUser);
      mockJwtService.verify.mockReturnValue({
        sub: oauthOnlyUser.id,
        purpose: TOKEN_PURPOSE.REAUTH_PROOF,
        operation: STEP_UP_OPERATION.EMAIL_CHANGE,
        iat: Math.floor(Date.now() / 1000)
      });

      await expect(
        service.assertStepUpForUser(
          oauthOnlyUser.id,
          undefined,
          'proof',
          STEP_UP_OPERATION.PASSWORD_SET
        )
      ).rejects.toMatchObject({
        response: { errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED }
      });
    });

    it('refuses a proof that names no operation at all', async () => {
      const oauthOnlyUser = { ...mockUser, password: null };
      mockUsersService.findOne.mockResolvedValue(oauthOnlyUser);
      mockJwtService.verify.mockReturnValue({
        sub: oauthOnlyUser.id,
        purpose: TOKEN_PURPOSE.REAUTH_PROOF,
        iat: Math.floor(Date.now() / 1000)
      });

      await expect(
        service.assertStepUpForUser(
          oauthOnlyUser.id,
          undefined,
          'proof',
          STEP_UP_OPERATION.PASSWORD_SET
        )
      ).rejects.toMatchObject({
        response: { errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED }
      });
    });
  });

  describe('assertStepUp', () => {
    it('accepts a valid authenticator code in place of the provider round trip', async () => {
      // An account created through a provider holds no password, so before the
      // second factor existed a provider round trip was its only way to step up.
      const user = { id: 'user-1', password: null } as User;
      mockMfaService.isValidStepUpCode.mockImplementation(
        (_user: User, code: string | undefined) =>
          Promise.resolve(code === '123456')
      );

      await expect(
        service.assertStepUp(
          user,
          undefined,
          undefined,
          STEP_UP_OPERATION.MFA_DISABLE,
          '123456'
        )
      ).resolves.toBeUndefined();
    });

    it('still demands the provider proof when the code is wrong', async () => {
      const user = { id: 'user-1', password: null } as User;
      mockMfaService.isValidStepUpCode.mockResolvedValue(false);

      await expect(
        service.assertStepUp(
          user,
          undefined,
          undefined,
          STEP_UP_OPERATION.MFA_DISABLE,
          '000000'
        )
      ).rejects.toMatchObject({
        response: { errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED }
      });
    });

    it('accepts a valid authenticator code in place of the password', async () => {
      const compare = jest.spyOn(bcrypt, 'compare').mockClear();
      const user = { id: 'user-1', password: '$2b$12$hash' } as User;
      mockMfaService.isValidStepUpCode.mockResolvedValue(true);

      await expect(
        service.assertStepUp(
          user,
          undefined,
          undefined,
          STEP_UP_OPERATION.MFA_DISABLE,
          '123456'
        )
      ).resolves.toBeUndefined();
      expect(compare).not.toHaveBeenCalled();
    });

    it('audits a refused password, and never records the value tried', async () => {
      const user = {
        id: 'user-1',
        email: 'user@example.com',
        password: '$2b$12$hash'
      } as User;
      mockMfaService.isValidStepUpCode.mockResolvedValue(false);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.assertStepUp(
          user,
          'WrongPass1',
          undefined,
          STEP_UP_OPERATION.MFA_DISABLE,
          '000000',
          { ip: '203.0.113.7', requestId: 'req-1' }
        )
      ).rejects.toMatchObject({
        response: { errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD }
      });

      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith({
        action: AuditAction.STEP_UP_FAILURE,
        actorId: 'user-1',
        actorEmail: 'user@example.com',
        targetId: 'user-1',
        targetType: 'User',
        details: {
          operation: STEP_UP_OPERATION.MFA_DISABLE,
          factor: 'password',
          codeOffered: true
        },
        context: { ip: '203.0.113.7', requestId: 'req-1' }
      });
      expect(
        JSON.stringify(mockAuditService.logFireAndForget.mock.calls)
      ).not.toContain('WrongPass1');
    });

    it('audits a refused provider proof', async () => {
      const user = {
        id: 'user-1',
        email: 'user@example.com',
        password: null
      } as User;
      mockMfaService.isValidStepUpCode.mockResolvedValue(false);

      await expect(
        service.assertStepUp(
          user,
          undefined,
          undefined,
          STEP_UP_OPERATION.MFA_SETUP
        )
      ).rejects.toMatchObject({
        response: { errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED }
      });

      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.STEP_UP_FAILURE,
          details: {
            operation: STEP_UP_OPERATION.MFA_SETUP,
            factor: 'reauth_proof',
            codeOffered: false
          }
        })
      );
    });

    it('writes no row when the caller proves itself', async () => {
      const user = { id: 'user-1', password: '$2b$12$hash' } as User;
      mockMfaService.isValidStepUpCode.mockResolvedValue(false);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await service.assertStepUp(
        user,
        'CorrectPassword1',
        undefined,
        STEP_UP_OPERATION.PASSWORD_SET
      );

      expect(mockAuditService.logFireAndForget).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.STEP_UP_FAILURE })
      );
    });

    describe('per-account password brake', () => {
      const passwordUser = {
        id: 'user-1',
        email: 'user@example.com',
        password: '$2b$12$hash'
      } as User;

      async function guessWrong(times: number): Promise<void> {
        jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
        for (let i = 0; i < times; i += 1) {
          await expect(
            service.assertStepUp(
              passwordUser,
              'WrongPass1',
              undefined,
              STEP_UP_OPERATION.PASSWORD_SET
            )
          ).rejects.toMatchObject({
            response: { errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD }
          });
        }
      }

      async function exhaustBudget(): Promise<void> {
        await guessWrong(MAX_FAILED_ATTEMPTS - 1);
        await expect(
          service.assertStepUp(
            passwordUser,
            'WrongPass1',
            undefined,
            STEP_UP_OPERATION.PASSWORD_SET
          )
        ).rejects.toMatchObject({ status: HttpStatus.LOCKED });
      }

      beforeEach(() => {
        mockMfaService.isValidStepUpCode.mockResolvedValue(false);
      });

      it('bars the account after the same number of tries the sign-in gets', async () => {
        await guessWrong(MAX_FAILED_ATTEMPTS - 1);

        // The route throttle is keyed by client address, so an attacker who
        // holds a session buys a fresh budget with every address it adds.
        await expect(
          service.assertStepUp(
            passwordUser,
            'WrongPass1',
            undefined,
            STEP_UP_OPERATION.PASSWORD_SET
          )
        ).rejects.toMatchObject({
          status: HttpStatus.LOCKED,
          response: {
            errorKey: ErrorKeys.AUTH.STEP_UP_LOCKED,
            retryAfter: expect.any(Number) as unknown,
            lockedUntil: expect.any(String) as unknown
          }
        });
      });

      it('audits the attempt that bars the account', async () => {
        await guessWrong(MAX_FAILED_ATTEMPTS - 1);
        mockAuditService.logFireAndForget.mockClear();

        await expect(
          service.assertStepUp(
            passwordUser,
            'WrongPass1',
            undefined,
            STEP_UP_OPERATION.PASSWORD_SET
          )
        ).rejects.toMatchObject({ status: HttpStatus.LOCKED });

        // The attempt that spends the last of the budget is the one a reader
        // of the trail most needs, so the row is written before the refusal.
        expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
          expect.objectContaining({
            action: AuditAction.STEP_UP_FAILURE,
            details: expect.objectContaining({
              factor: 'password'
            }) as unknown
          })
        );
      });

      it('refuses a correct password while the account is barred', async () => {
        await exhaustBudget();

        jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
        await expect(
          service.assertStepUp(
            passwordUser,
            'CorrectPassword1',
            undefined,
            STEP_UP_OPERATION.PASSWORD_SET
          )
        ).rejects.toMatchObject({
          status: HttpStatus.LOCKED,
          response: { errorKey: ErrorKeys.AUTH.STEP_UP_LOCKED }
        });
      });

      it('leaves the sign-in lockout counter alone', async () => {
        await exhaustBudget();

        // The two counters hold separate namespaces on purpose: a caller who
        // holds a stolen session must not be able to shut the owner out of the
        // way back in.
        expect(
          mockUsersService.incrementFailedAttemptsAndLockIfNeeded
        ).not.toHaveBeenCalled();
      });

      it('does not count a step-up that offers no password', async () => {
        for (let i = 0; i < MAX_FAILED_ATTEMPTS * 2; i += 1) {
          await expect(
            service.assertStepUp(
              passwordUser,
              undefined,
              undefined,
              STEP_UP_OPERATION.PASSWORD_SET
            )
          ).rejects.toMatchObject({
            response: { errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD }
          });
        }

        jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
        await expect(
          service.assertStepUp(
            passwordUser,
            'CorrectPassword1',
            undefined,
            STEP_UP_OPERATION.PASSWORD_SET
          )
        ).resolves.toBeUndefined();
      });

      it('leaves the counter untouched for an account that holds no password', async () => {
        const oauthOnly = { ...passwordUser, password: null } as User;

        for (let i = 0; i < MAX_FAILED_ATTEMPTS * 2; i += 1) {
          await expect(
            service.assertStepUp(
              oauthOnly,
              undefined,
              undefined,
              STEP_UP_OPERATION.PASSWORD_SET
            )
          ).rejects.toMatchObject({
            response: { errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED }
          });
        }

        jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
        await expect(
          service.assertStepUp(
            passwordUser,
            'CorrectPassword1',
            undefined,
            STEP_UP_OPERATION.PASSWORD_SET
          )
        ).resolves.toBeUndefined();
      });

      it('closes the window on a correct password', async () => {
        await guessWrong(MAX_FAILED_ATTEMPTS - 1);

        jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
        await expect(
          service.assertStepUp(
            passwordUser,
            'CorrectPassword1',
            undefined,
            STEP_UP_OPERATION.PASSWORD_SET
          )
        ).resolves.toBeUndefined();

        await guessWrong(MAX_FAILED_ATTEMPTS - 1);
        jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
        await expect(
          service.assertStepUp(
            passwordUser,
            'CorrectPassword1',
            undefined,
            STEP_UP_OPERATION.PASSWORD_SET
          )
        ).resolves.toBeUndefined();
      });
    });
  });

  describe('initiateEmailChange', () => {
    // The service uses manager.createQueryBuilder(User, 'u').where(...).andWhere(...).getOne()
    // to find any other user holding the address. Default: no conflict.
    let getOneSpy: jest.Mock;
    let userQb: {
      where: jest.Mock;
      andWhere: jest.Mock;
      getOne: jest.Mock;
    };

    beforeEach(() => {
      getOneSpy = jest.fn().mockResolvedValue(null);
      userQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: getOneSpy
      };
      // Differentiate between the relation builder (used in register: no args)
      // and the entity builder (passes the User entity as first arg).
      mockManager.createQueryBuilder = jest.fn((arg?: unknown) =>
        arg ? userQb : mockRelationQb
      ) as jest.Mock;
    });

    it('happy path: verifies password, stores token, sends both emails', async () => {
      mockUsersService.findOne.mockResolvedValue({ ...mockUser });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.initiateEmailChange('user-1', {
        newEmail: 'new@example.com',
        currentPassword: 'CorrectPassword1'
      });

      expect(mockManager.update).toHaveBeenCalledWith(
        expect.anything(),
        'user-1',
        expect.objectContaining({
          pendingEmail: 'new@example.com',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          pendingEmailToken: expect.any(String),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          pendingEmailExpiresAt: expect.any(Date)
        })
      );
      expect(mockMailService.sendEmailChangeConfirmation).toHaveBeenCalledWith(
        'new@example.com',
        expect.any(String),
        'en'
      );
      expect(
        mockMailService.sendEmailChangeNotificationOld
      ).toHaveBeenCalledWith('test@example.com', 'new@example.com', 'en');
      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_EMAIL_CHANGE_REQUEST,
          details: { newEmailDomain: 'example.com', conflict: false }
        })
      );
      expect(result.message).toMatch(/confirmation link/);
    });

    it('rejects OAuth-only users (no password)', async () => {
      mockUsersService.findOne.mockResolvedValue({
        ...mockUser,
        password: null
      });

      try {
        await service.initiateEmailChange('user-1', {
          newEmail: 'new@example.com',
          currentPassword: 'anything'
        });
        fail('Expected HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      }
      expect(mockManager.update).not.toHaveBeenCalled();
    });

    describe('an account that holds no password', () => {
      const oauthOnlyUser = () => ({
        ...mockUser,
        password: null,
        hasPassword: false
      });

      // The proof is single use, so every case in this block needs its own id.
      let proofCounter = 0;

      const validProof = () => ({
        sub: 'user-1',
        purpose: TOKEN_PURPOSE.REAUTH_PROOF,
        operation: STEP_UP_OPERATION.EMAIL_CHANGE,
        iat: Math.floor(Date.now() / 1000),
        jti: `proof-${(proofCounter += 1)}`
      });

      beforeEach(() => {
        mockUsersService.findOne.mockResolvedValue(oauthOnlyUser());
      });

      it('proceeds on a valid re-authentication proof and never checks a password', async () => {
        // Earlier cases in this file leave calls on the shared bcrypt spy.
        const compare = jest.spyOn(bcrypt, 'compare').mockClear();
        mockJwtService.verify.mockReturnValue(validProof());

        const result = await service.initiateEmailChange(
          'user-1',
          { newEmail: 'new@example.com' },
          'proof-token'
        );

        expect(result.message).toBeDefined();
        expect(compare).not.toHaveBeenCalled();
        expect(mockManager.update).toHaveBeenCalled();
      });

      it('refuses when no proof is presented', async () => {
        await expect(
          service.initiateEmailChange('user-1', { newEmail: 'new@example.com' })
        ).rejects.toMatchObject({
          response: { errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED }
        });
        expect(mockManager.update).not.toHaveBeenCalled();
      });

      it('refuses a proof minted for another account', async () => {
        mockJwtService.verify.mockReturnValue({
          ...validProof(),
          sub: 'someone-else'
        });

        await expect(
          service.initiateEmailChange(
            'user-1',
            { newEmail: 'new@example.com' },
            'proof-token'
          )
        ).rejects.toMatchObject({
          response: { errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED }
        });
        expect(mockManager.update).not.toHaveBeenCalled();
      });

      it('refuses a token minted for a different purpose', async () => {
        mockJwtService.verify.mockReturnValue({
          ...validProof(),
          purpose: TOKEN_PURPOSE.ACCESS
        });

        await expect(
          service.initiateEmailChange(
            'user-1',
            { newEmail: 'new@example.com' },
            'access-token'
          )
        ).rejects.toMatchObject({
          response: { errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED }
        });
      });

      it('refuses a proof older than the last session revocation', async () => {
        const now = Math.floor(Date.now() / 1000);
        mockUsersService.findOne.mockResolvedValue({
          ...oauthOnlyUser(),
          tokenRevokedAt: new Date(now * 1000)
        });
        mockJwtService.verify.mockReturnValue({
          ...validProof(),
          iat: now - 60
        });

        await expect(
          service.initiateEmailChange(
            'user-1',
            { newEmail: 'new@example.com' },
            'stale-proof'
          )
        ).rejects.toMatchObject({
          response: { errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED }
        });
      });

      it('refuses a proof that does not verify at all', async () => {
        mockJwtService.verify.mockImplementation(() => {
          throw new Error('bad signature');
        });

        await expect(
          service.initiateEmailChange(
            'user-1',
            { newEmail: 'new@example.com' },
            'forged'
          )
        ).rejects.toMatchObject({
          response: { errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED }
        });
      });
    });

    it('rejects an account that holds a password and supplies none', async () => {
      mockUsersService.findOne.mockResolvedValue({ ...mockUser });

      await expect(
        service.initiateEmailChange('user-1', { newEmail: 'new@example.com' })
      ).rejects.toMatchObject({
        response: { errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD }
      });
      expect(mockManager.update).not.toHaveBeenCalled();
    });

    it('rejects when current password is wrong', async () => {
      mockUsersService.findOne.mockResolvedValue({ ...mockUser });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.initiateEmailChange('user-1', {
          newEmail: 'new@example.com',
          currentPassword: 'wrong'
        })
      ).rejects.toThrow(HttpException);
      expect(mockManager.update).not.toHaveBeenCalled();
    });

    it('rejects when new email equals current email', async () => {
      mockUsersService.findOne.mockResolvedValue({ ...mockUser });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await expect(
        service.initiateEmailChange('user-1', {
          newEmail: 'test@example.com',
          currentPassword: 'CorrectPassword1'
        })
      ).rejects.toThrow(HttpException);
    });

    it('returns enumeration-safe success when address is already taken', async () => {
      mockUsersService.findOne.mockResolvedValue({ ...mockUser });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      getOneSpy.mockResolvedValue({ id: 'other-user' }); // conflict

      const result = await service.initiateEmailChange('user-1', {
        newEmail: 'taken@example.com',
        currentPassword: 'CorrectPassword1'
      });

      expect(mockManager.update).not.toHaveBeenCalled();
      expect(
        mockMailService.sendEmailChangeConfirmation
      ).not.toHaveBeenCalled();
      expect(
        mockMailService.sendEmailChangeNotificationOld
      ).not.toHaveBeenCalled();
      expect(result.message).toMatch(/confirmation link/);
      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          details: { newEmailDomain: 'example.com', conflict: true }
        })
      );
    });

    it('stays enumeration-safe when the unique index rejects the write', async () => {
      mockUsersService.findOne.mockResolvedValue({ ...mockUser });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      // Nobody held the address at check time; a concurrent request claimed it
      // before this write landed.
      mockManager.update.mockRejectedValue({ code: '23505' });

      const result = await service.initiateEmailChange('user-1', {
        newEmail: 'taken@example.com',
        currentPassword: 'CorrectPassword1'
      });

      expect(result.message).toMatch(/confirmation link/);
      expect(
        mockMailService.sendEmailChangeConfirmation
      ).not.toHaveBeenCalled();
      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          details: { newEmailDomain: 'example.com', conflict: true }
        })
      );
    });

    it('propagates unrelated database failures', async () => {
      mockUsersService.findOne.mockResolvedValue({ ...mockUser });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      mockManager.update.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.initiateEmailChange('user-1', {
          newEmail: 'new@example.com',
          currentPassword: 'CorrectPassword1'
        })
      ).rejects.toThrow('connection lost');
    });
  });

  describe('confirmEmailChange', () => {
    let userQb: {
      where: jest.Mock;
      andWhere: jest.Mock;
      getOne: jest.Mock;
    };

    beforeEach(() => {
      userQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null) // no concurrent claim by default
      };
      mockManager.createQueryBuilder = jest.fn((arg?: unknown) =>
        arg ? userQb : mockRelationQb
      ) as jest.Mock;
    });

    it('applies email change, revokes sessions, sends notification', async () => {
      const pendingUser = {
        ...mockUser,
        pendingEmail: 'new@example.com',
        pendingEmailToken: 'hashed-token',
        pendingEmailExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
      };
      mockManager.findOne.mockResolvedValue(pendingUser);

      const result = await service.confirmEmailChange('raw-token');

      expect(mockManager.update).toHaveBeenCalledWith(
        expect.anything(),
        'user-1',
        expect.objectContaining({
          email: 'new@example.com',
          isEmailVerified: true,
          pendingEmail: null,
          pendingEmailToken: null,
          pendingEmailExpiresAt: null,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          tokenRevokedAt: expect.any(Date)
        })
      );
      expect(mockManager.delete).toHaveBeenCalledWith(expect.anything(), {
        userId: 'user-1'
      });
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_EMAIL_CHANGE_COMPLETE,
          details: { oldEmail: 'test@example.com', newEmail: 'new@example.com' }
        })
      );
      expect(
        mockMailService.sendEmailChangeCompletedNotification
      ).toHaveBeenCalledWith('test@example.com', 'new@example.com', 'en');
      expect(result.message).toMatch(/sign in again/);
    });

    it('throws 400 when token not found', async () => {
      mockManager.findOne.mockResolvedValue(null);

      await expect(service.confirmEmailChange('invalid')).rejects.toThrow(
        HttpException
      );
      expect(mockManager.update).not.toHaveBeenCalled();
    });

    it('refuses a deactivated account with the not-found envelope', async () => {
      const pendingUser = {
        ...mockUser,
        isActive: false,
        pendingEmail: 'new@example.com',
        pendingEmailToken: 'hashed-token',
        pendingEmailExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
      };
      mockManager.findOne.mockResolvedValue(pendingUser);

      const rejection = await service.confirmEmailChange('raw-token').then(
        () => null,
        (err: unknown) => err
      );

      expect(rejection).toBeInstanceOf(HttpException);
      const httpError = rejection as HttpException;
      expect(httpError.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(httpError.getResponse()).toEqual({
        message: 'Invalid or expired email-change token',
        errorKey: ErrorKeys.AUTH.PENDING_EMAIL_TOKEN_EXPIRED
      });
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(mockManager.delete).not.toHaveBeenCalled();
      expect(mockUsersService.clearPendingEmailChange).not.toHaveBeenCalled();
    });

    it('clears state and throws 400 when token is expired', async () => {
      const pendingUser = {
        ...mockUser,
        pendingEmail: 'new@example.com',
        pendingEmailToken: 'hashed-token',
        pendingEmailExpiresAt: new Date(Date.now() - 1000)
      };
      mockManager.findOne.mockResolvedValue(pendingUser);

      await expect(service.confirmEmailChange('raw-token')).rejects.toThrow(
        HttpException
      );
      // Cleared outside the transaction: an in-transaction clear followed by a
      // throw would be rolled back and the dead token would survive.
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(mockUsersService.clearPendingEmailChange).toHaveBeenCalledWith(
        'user-1'
      );
    });

    it('throws 409 and clears pending fields when another user claimed the address', async () => {
      const pendingUser = {
        ...mockUser,
        pendingEmail: 'race@example.com',
        pendingEmailToken: 'hashed-token',
        pendingEmailExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
      };
      mockManager.findOne.mockResolvedValue(pendingUser);
      // Conflicting other user under the same address
      userQb.getOne.mockResolvedValue({ id: 'other-user' });

      try {
        await service.confirmEmailChange('raw-token');
        fail('Expected HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
      }
      // The pending fields must be cleared so the user can re-initiate cleanly,
      // and outside the transaction so the throw cannot roll the clear back.
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(mockUsersService.clearPendingEmailChange).toHaveBeenCalledWith(
        'user-1'
      );
    });

    it('translates a unique violation on the write into the documented 409', async () => {
      const pendingUser = {
        ...mockUser,
        pendingEmail: 'race@example.com',
        pendingEmailToken: 'hashed-token',
        pendingEmailExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
      };
      mockManager.findOne.mockResolvedValue(pendingUser);
      // Nobody held the address at check time; the index rejects the write.
      mockManager.update.mockRejectedValue({ code: '23505' });

      try {
        await service.confirmEmailChange('raw-token');
        fail('Expected HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
        expect((err as HttpException).getResponse()).toEqual(
          expect.objectContaining({
            errorKey: ErrorKeys.USERS.EMAIL_EXISTS
          })
        );
      }
      expect(mockUsersService.clearPendingEmailChange).toHaveBeenCalledWith(
        'user-1'
      );
    });

    it('does not translate unrelated database failures', async () => {
      const pendingUser = {
        ...mockUser,
        pendingEmail: 'new@example.com',
        pendingEmailToken: 'hashed-token',
        pendingEmailExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
      };
      mockManager.findOne.mockResolvedValue(pendingUser);
      mockManager.update.mockRejectedValue(new Error('connection lost'));

      await expect(service.confirmEmailChange('raw-token')).rejects.toThrow(
        'connection lost'
      );
      expect(mockUsersService.clearPendingEmailChange).not.toHaveBeenCalled();
    });
  });
});
