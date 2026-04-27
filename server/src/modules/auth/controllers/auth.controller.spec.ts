import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException, Logger, UnauthorizedException } from '@nestjs/common';
import { Request as ExpressRequest, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from '../services/auth.service';
import { UsersService } from '../../users/services/users.service';
import { PermissionService } from '../services/permission.service';
import { CaslAbilityFactory } from '../casl/casl-ability.factory';
import { AuditService } from '../../audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { LocalAuthGuard } from '../guards/local-auth.guard';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { JwtAuthRequest, LocalAuthRequest } from '../types/auth.request';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { UserResponseDto } from '../../users/dtos/user-response.dto';

const allowAllGuard = { canActivate: () => true };

function mockJwtRequest(
  userId = 'user-1',
  email = 'admin@example.com'
): {
  user: JwtAuthRequest['user'];
  ip: string;
  headers: Record<string, string>;
} {
  return {
    user: { userId, email, roles: [] },
    ip: '127.0.0.1',
    headers: {}
  };
}

const mockAdminRole = {
  id: 'role-uuid-admin',
  name: 'admin',
  description: 'Administrator role',
  isSystem: true,
  isSuper: false,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01')
};

function mockLocalAuthRequest(
  id = 'user-1',
  email = 'admin@example.com'
): {
  user: UserResponseDto;
  ip: string;
  headers: Record<string, string>;
  cookies: Record<string, string>;
} {
  const user: UserResponseDto = {
    id,
    email,
    firstName: 'Admin',
    lastName: 'User',
    isActive: true,
    roles: [mockAdminRole],
    isEmailVerified: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    deletedAt: null
  };
  return { user, ip: '127.0.0.1', headers: {}, cookies: {} };
}

function mockExpressRequest(cookies: Record<string, string> = {}): {
  ip: string;
  headers: Record<string, string>;
  cookies: Record<string, string>;
} {
  return { ip: '127.0.0.1', headers: {}, cookies };
}

type MockedResponse = { cookie: jest.Mock; clearCookie: jest.Mock };

function mockResponse(): MockedResponse & Response {
  return { cookie: jest.fn(), clearCookie: jest.fn() } as MockedResponse &
    Response;
}

describe('AuthController', () => {
  let controller: AuthController;
  let authServiceMock: {
    register: jest.Mock;
    login: jest.Mock;
    refreshTokens: jest.Mock;
    logout: jest.Mock;
    verifyEmail: jest.Mock;
    resendVerificationEmail: jest.Mock;
    forgotPassword: jest.Mock;
    resetPassword: jest.Mock;
    verifyCurrentPassword: jest.Mock;
  };
  let userServiceMock: {
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let permissionServiceMock: {
    getRolesForUser: jest.Mock;
    getPermissionsForUser: jest.Mock;
  };
  let caslAbilityFactoryMock: {
    createForUser: jest.Mock;
  };
  let auditServiceMock: {
    log: jest.Mock;
  };

  const mockAuthResult = {
    tokens: {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600
    },
    user: {
      id: 'user-1',
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      isActive: true,
      roles: [mockAdminRole],
      isEmailVerified: true,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      deletedAt: null
    }
  };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    authServiceMock = {
      register: jest.fn().mockResolvedValue({ id: 'user-1' }),
      login: jest.fn().mockResolvedValue(mockAuthResult),
      refreshTokens: jest.fn().mockResolvedValue(mockAuthResult),
      logout: jest.fn().mockResolvedValue(undefined),
      verifyEmail: jest.fn().mockResolvedValue({ message: 'verified' }),
      resendVerificationEmail: jest.fn().mockResolvedValue({ message: 'sent' }),
      forgotPassword: jest.fn().mockResolvedValue({ message: 'sent' }),
      resetPassword: jest.fn().mockResolvedValue({ message: 'reset' }),
      verifyCurrentPassword: jest.fn().mockResolvedValue(undefined)
    };

    userServiceMock = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', email: 'admin@example.com' }),
      update: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', email: 'admin@example.com' })
    };

    permissionServiceMock = {
      getRolesForUser: jest.fn().mockResolvedValue([{ name: 'admin' }]),
      getPermissionsForUser: jest.fn().mockResolvedValue([])
    };

    caslAbilityFactoryMock = {
      createForUser: jest.fn().mockResolvedValue({ rules: [] })
    };

    auditServiceMock = {
      log: jest.fn().mockResolvedValue(undefined)
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: UsersService, useValue: userServiceMock },
        { provide: PermissionService, useValue: permissionServiceMock },
        { provide: CaslAbilityFactory, useValue: caslAbilityFactoryMock },
        { provide: AuditService, useValue: auditServiceMock },
        {
          provide: MetricsService,
          useValue: { recordAuthEvent: jest.fn() }
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'JWT_REFRESH_EXPIRATION') return '604800';
              if (key === 'ENVIRONMENT') return 'development';
              return undefined;
            })
          }
        }
      ]
    })
      .overrideGuard(LocalAuthGuard)
      .useValue(allowAllGuard)
      .overrideGuard(JwtAuthGuard)
      .useValue(allowAllGuard)
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── register ──────────────────────────────────────────────────────

  describe('register', () => {
    it('should delegate to authService.register and return result', async () => {
      const dto = {
        email: 'new@example.com',
        password: 'Password1',
        firstName: 'New',
        lastName: 'User'
      };
      const req = mockExpressRequest() as ExpressRequest;

      const result = await controller.register(dto as never, req);

      expect(authServiceMock.register).toHaveBeenCalledWith(
        dto,
        expect.objectContaining({ ip: '127.0.0.1' })
      );
      expect(result).toEqual({ id: 'user-1' });
    });
  });

  // ── login ─────────────────────────────────────────────────────────

  describe('login', () => {
    it('should return tokens (without refresh_token) and user', async () => {
      const req = mockLocalAuthRequest() as LocalAuthRequest;
      const res = mockResponse();

      const result = await controller.login(req, res);

      expect(result).toEqual({
        tokens: { access_token: 'access-token', expires_in: 3600 },
        user: mockAuthResult.user
      });
      expect(result.tokens).not.toHaveProperty('refresh_token');
    });

    it('should set refresh_token cookie', async () => {
      const req = mockLocalAuthRequest() as LocalAuthRequest;
      const res = mockResponse();

      await controller.login(req, res);

      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          path: '/api/v1/auth',
          maxAge: 604800 * 1000
        })
      );
    });

    // Login response.user.roles must be RoleResponse[] objects — the client
    // relies on this to decide the admin badge without a reload. A regression
    // to `string[]` here would resurrect a fixed bug.
    it('should return user.roles as RoleResponse[] objects', async () => {
      const req = mockLocalAuthRequest() as LocalAuthRequest;
      const res = mockResponse();

      const result = await controller.login(req, res);

      expect(Array.isArray(result.user.roles)).toBe(true);
      expect(result.user.roles).toHaveLength(1);
      const [role] = result.user.roles;
      expect(role).toEqual(
        expect.objectContaining({
          id: expect.any(String) as unknown,
          name: 'admin',
          isSystem: expect.any(Boolean) as unknown,
          isSuper: expect.any(Boolean) as unknown
        })
      );
      // Must not regress to the legacy string[] shape.
      expect(typeof role).not.toBe('string');
    });

    it('should log USER_LOGIN_SUCCESS audit event', async () => {
      const req = mockLocalAuthRequest(
        'user-42',
        'user@example.com'
      ) as LocalAuthRequest;
      const res = mockResponse();

      await controller.login(req, res);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_LOGIN_SUCCESS,
          actorId: 'user-42',
          actorEmail: 'user@example.com',
          targetId: 'user-42',
          targetType: 'User'
        })
      );
    });
  });

  // ── refreshToken ──────────────────────────────────────────────────

  describe('refreshToken', () => {
    it('should throw UnauthorizedException when no refresh cookie', async () => {
      const req = mockExpressRequest({}) as ExpressRequest;
      const res = mockResponse();

      await expect(controller.refreshToken(req, res)).rejects.toThrow(
        UnauthorizedException
      );
    });

    it('should return new tokens and set cookie on success', async () => {
      const req = mockExpressRequest({
        refresh_token: 'old-refresh'
      }) as ExpressRequest;
      const res = mockResponse();

      const result = await controller.refreshToken(req, res);

      expect(authServiceMock.refreshTokens).toHaveBeenCalledWith('old-refresh');
      expect(result.tokens).not.toHaveProperty('refresh_token');
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-token',
        expect.objectContaining({ httpOnly: true, path: '/api/v1/auth' })
      );
    });

    // Refresh-token response.user.roles must be RoleResponse[] objects so
    // the client keeps the admin badge after a silent refresh.
    it('should return user.roles as RoleResponse[] objects', async () => {
      const req = mockExpressRequest({
        refresh_token: 'old-refresh'
      }) as ExpressRequest;
      const res = mockResponse();

      const result = await controller.refreshToken(req, res);

      expect(Array.isArray(result.user.roles)).toBe(true);
      expect(result.user.roles[0]).toEqual(
        expect.objectContaining({ name: 'admin' })
      );
      expect(typeof result.user.roles[0]).not.toBe('string');
    });
  });

  // ── logout ────────────────────────────────────────────────────────

  describe('logout', () => {
    it('should call authService.logout, clear cookie, and return success message', async () => {
      const req = mockJwtRequest(
        'user-1',
        'user@example.com'
      ) as JwtAuthRequest;
      const res = mockResponse();

      const result = await controller.logout(req, res);

      expect(authServiceMock.logout).toHaveBeenCalledWith('user-1');
      expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', {
        path: '/api/v1/auth'
      });
      expect(result).toEqual({ message: 'Successfully logged out' });
    });

    it('should log USER_LOGOUT audit event', async () => {
      const req = mockJwtRequest(
        'user-99',
        'logout@example.com'
      ) as JwtAuthRequest;
      const res = mockResponse();

      await controller.logout(req, res);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_LOGOUT,
          actorId: 'user-99',
          actorEmail: 'logout@example.com'
        })
      );
    });
  });

  // ── getProfile ────────────────────────────────────────────────────

  describe('getProfile', () => {
    it('should delegate to userService.findOne with the userId from token', async () => {
      const req = mockJwtRequest('user-5') as JwtAuthRequest;

      const result = await controller.getProfile(req);

      expect(userServiceMock.findOne).toHaveBeenCalledWith('user-5');
      expect(result).toEqual({ id: 'user-1', email: 'admin@example.com' });
    });
  });

  // ── updateProfile ─────────────────────────────────────────────────

  describe('updateProfile', () => {
    it('should update user profile and return updated user without logout when no password change', async () => {
      const req = mockJwtRequest('user-1') as JwtAuthRequest;
      const res = mockResponse();
      const dto = { firstName: 'Updated' };

      const result = await controller.updateProfile(req, dto as never, res);

      expect(userServiceMock.update).toHaveBeenCalledWith('user-1', dto);
      expect(authServiceMock.verifyCurrentPassword).not.toHaveBeenCalled();
      expect(authServiceMock.logout).not.toHaveBeenCalled();
      expect(res.clearCookie).not.toHaveBeenCalled();
      expect(auditServiceMock.log).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'user-1', email: 'admin@example.com' });
    });

    it('should call logout, clear cookie, and log PASSWORD_CHANGE when password is updated', async () => {
      const req = mockJwtRequest(
        'user-1',
        'changer@example.com'
      ) as JwtAuthRequest;
      const res = mockResponse();
      const dto = { password: 'NewPassword1', currentPassword: 'CurrentPass1' };

      await controller.updateProfile(req, dto as never, res);

      expect(authServiceMock.verifyCurrentPassword).toHaveBeenCalledWith(
        'user-1',
        'CurrentPass1'
      );
      expect(authServiceMock.logout).toHaveBeenCalledWith('user-1');
      expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', {
        path: '/api/v1/auth'
      });
      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PASSWORD_CHANGE,
          actorId: 'user-1',
          actorEmail: 'changer@example.com',
          targetId: 'user-1',
          targetType: 'User',
          details: { source: 'self' }
        })
      );
    });

    it('should strip currentPassword before delegating to userService.update', async () => {
      const req = mockJwtRequest('user-1') as JwtAuthRequest;
      const res = mockResponse();
      const dto = { password: 'NewPassword1', currentPassword: 'CurrentPass1' };

      await controller.updateProfile(req, dto as never, res);

      expect(userServiceMock.update).toHaveBeenCalledWith('user-1', {
        password: 'NewPassword1'
      });
    });

    it('should propagate INVALID_CURRENT_PASSWORD when verifyCurrentPassword throws', async () => {
      const req = mockJwtRequest('user-1') as JwtAuthRequest;
      const res = mockResponse();
      const dto = { password: 'NewPassword1', currentPassword: 'WrongPass1' };
      const httpErr = new HttpException(
        { errorKey: 'errors.auth.invalidCurrentPassword' },
        400
      );
      authServiceMock.verifyCurrentPassword.mockRejectedValueOnce(httpErr);

      await expect(
        controller.updateProfile(req, dto as never, res)
      ).rejects.toBe(httpErr);

      expect(userServiceMock.update).not.toHaveBeenCalled();
      expect(authServiceMock.logout).not.toHaveBeenCalled();
    });
  });

  // ── getPermissions ────────────────────────────────────────────────

  describe('getPermissions', () => {
    it('should return packed rules and role names', async () => {
      const req = mockJwtRequest('user-1') as JwtAuthRequest;

      const result = await controller.getPermissions(req);

      expect(permissionServiceMock.getRolesForUser).toHaveBeenCalledWith(
        'user-1'
      );
      expect(permissionServiceMock.getPermissionsForUser).toHaveBeenCalledWith(
        'user-1'
      );
      expect(caslAbilityFactoryMock.createForUser).toHaveBeenCalledWith(
        'user-1',
        [{ name: 'admin' }],
        []
      );
      expect(result).toEqual({ roles: ['admin'], rules: [] });
    });
  });

  // ── verifyEmail ───────────────────────────────────────────────────

  describe('verifyEmail', () => {
    it('should delegate to authService.verifyEmail with the token', async () => {
      const dto = { token: 'verify-token-123' };

      const result = await controller.verifyEmail(dto);

      expect(authServiceMock.verifyEmail).toHaveBeenCalledWith(
        'verify-token-123'
      );
      expect(result).toEqual({ message: 'verified' });
    });
  });

  // ── resendVerification ────────────────────────────────────────────

  describe('resendVerification', () => {
    it('should delegate to authService.resendVerificationEmail', async () => {
      const dto = { email: 'resend@example.com' };

      const result = await controller.resendVerification(dto);

      expect(authServiceMock.resendVerificationEmail).toHaveBeenCalledWith(
        'resend@example.com'
      );
      expect(result).toEqual({ message: 'sent' });
    });
  });

  // ── forgotPassword ────────────────────────────────────────────────

  describe('forgotPassword', () => {
    it('should delegate to authService.forgotPassword with email and audit context', async () => {
      const dto = { email: 'forgot@example.com' };
      const req = mockExpressRequest() as ExpressRequest;

      const result = await controller.forgotPassword(dto, req);

      expect(authServiceMock.forgotPassword).toHaveBeenCalledWith(
        'forgot@example.com',
        expect.objectContaining({ ip: '127.0.0.1' })
      );
      expect(result).toEqual({ message: 'sent' });
    });
  });

  // ── resetPassword ─────────────────────────────────────────────────

  describe('resetPassword', () => {
    it('should delegate to authService.resetPassword with token, password, and audit context', async () => {
      const dto = { token: 'reset-token-abc', password: 'NewPassword1' };
      const req = mockExpressRequest() as ExpressRequest;

      const result = await controller.resetPassword(dto, req);

      expect(authServiceMock.resetPassword).toHaveBeenCalledWith(
        'reset-token-abc',
        'NewPassword1',
        expect.objectContaining({ ip: '127.0.0.1' })
      );
      expect(result).toEqual({ message: 'reset' });
    });
  });
});
