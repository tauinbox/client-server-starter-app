import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MAX_CONCURRENT_SESSIONS } from '@app/shared/constants';
import { EntitlementService } from '../../entitlements/entitlement.service';
import { RefreshTokenService } from './refresh-token.service';
import { SessionIssuerService } from './session-issuer.service';
import { SessionLimitService } from './session-limit.service';
import { TokenGeneratorService } from './token-generator.service';

describe('SessionIssuerService', () => {
  let service: SessionIssuerService;
  let createRefreshTokenSettled: boolean;
  let pruneSawSettledCreate: boolean;
  let mockRefreshTokenService: {
    createRefreshToken: jest.Mock;
    pruneOldestTokens: jest.Mock;
  };
  let mockTokenGenerator: { generateTokens: jest.Mock };
  let mockConfigService: { getOrThrow: jest.Mock };
  let mockEntitlementService: { limitFor: jest.Mock };

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
    roles: [mockUserRole],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt: null
  };

  beforeEach(async () => {
    createRefreshTokenSettled = false;
    pruneSawSettledCreate = false;

    mockRefreshTokenService = {
      // Resolves a microtask late so a dropped `await` at the call site shows
      // up as an unsettled write rather than passing by accident.
      createRefreshToken: jest.fn().mockImplementation(async () => {
        await Promise.resolve();
        createRefreshTokenSettled = true;
      }),
      pruneOldestTokens: jest.fn().mockImplementation(() => {
        pruneSawSettledCreate = createRefreshTokenSettled;
        return Promise.resolve();
      })
    };

    mockTokenGenerator = {
      generateTokens: jest.fn().mockReturnValue({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600
      })
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

    // Free tier by default: no plan-specific allowance, so pruning falls back
    // to the constant. Individual tests raise it.
    mockEntitlementService = {
      limitFor: jest.fn().mockResolvedValue(null)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionIssuerService,
        SessionLimitService,
        { provide: EntitlementService, useValue: mockEntitlementService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RefreshTokenService, useValue: mockRefreshTokenService },
        { provide: TokenGeneratorService, useValue: mockTokenGenerator }
      ]
    }).compile();

    service = module.get<SessionIssuerService>(SessionIssuerService);
  });

  it('persists the refresh token before pruning, so the new session counts against the allowance', async () => {
    await service.issueSession(mockUser);

    expect(
      mockRefreshTokenService.createRefreshToken.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mockRefreshTokenService.pruneOldestTokens.mock.invocationCallOrder[0]
    );
    expect(pruneSawSettledCreate).toBe(true);
  });

  it('prunes to the resolved allowance, never to the pending promise', async () => {
    mockEntitlementService.limitFor.mockResolvedValue(10);

    await service.issueSession(mockUser);

    // A dropped `await` on the limit lookup would hand the prune a pending
    // promise here, which no numeric expectation can match.
    expect(mockRefreshTokenService.pruneOldestTokens).toHaveBeenCalledWith(
      'user-1',
      10
    );
  });

  it('issues the session on the default allowance when entitlement resolution throws', async () => {
    mockEntitlementService.limitFor.mockRejectedValue(
      new Error('billing unavailable')
    );

    const result = await service.issueSession(mockUser);

    expect(result.tokens.access_token).toBe('mock-access-token');
    expect(mockRefreshTokenService.pruneOldestTokens).toHaveBeenCalledWith(
      'user-1',
      MAX_CONCURRENT_SESSIONS
    );
  });

  it('signs the JWT with role names and returns the User entity unchanged', async () => {
    const result = await service.issueSession(mockUser);

    expect(mockTokenGenerator.generateTokens).toHaveBeenCalledWith(
      'user-1',
      'test@example.com',
      ['user']
    );
    expect(mockRefreshTokenService.createRefreshToken).toHaveBeenCalledWith(
      'user-1',
      'mock-refresh-token',
      604800
    );
    expect(result.user).toBe(mockUser);
  });
});
