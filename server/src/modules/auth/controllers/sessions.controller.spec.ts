import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ErrorKeys, STEP_UP_OPERATION } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { SessionsController } from './sessions.controller';
import { AuthService } from '../services/auth.service';
import { RefreshTokenService } from '../services/refresh-token.service';
import { UsersService } from '../../users/services/users.service';
import { AuditService } from '../../audit/audit.service';
import { User } from '../../users/entities/user.entity';
import { JwtAuthRequest } from '../types/auth.request';
import { createMockRequest } from '../../../common/testing/express.mock';
import { AuthCookies } from '../utils/auth-cookies';

type MockedResponse = { clearCookie: jest.Mock };

function mockResponse(): MockedResponse & Response {
  return { clearCookie: jest.fn() } as MockedResponse & Response;
}

const mockUser = { id: 'user-1', email: 'user@example.com' } as User;

function jwtRequest(cookies: Record<string, string> = {}): JwtAuthRequest {
  return createMockRequest({
    user: {
      userId: 'user-1',
      email: 'user@example.com',
      roles: ['user'],
      sessionId: 'current-session'
    },
    ip: '127.0.0.1',
    headers: {},
    cookies
  });
}

describe('SessionsController', () => {
  let controller: SessionsController;
  let authService: { assertStepUp: jest.Mock };
  let refreshTokenService: {
    findLiveSessions: jest.Mock;
    deleteUserSession: jest.Mock;
    deleteOtherSessions: jest.Mock;
  };
  let auditService: { log: jest.Mock };

  beforeEach(async () => {
    authService = { assertStepUp: jest.fn().mockResolvedValue(undefined) };
    refreshTokenService = {
      findLiveSessions: jest.fn(),
      deleteUserSession: jest.fn().mockResolvedValue(true),
      deleteOtherSessions: jest.fn().mockResolvedValue(2)
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionsController],
      providers: [
        AuthCookies,
        { provide: AuthService, useValue: authService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        {
          provide: UsersService,
          useValue: { findOne: jest.fn().mockResolvedValue(mockUser) }
        },
        { provide: AuditService, useValue: auditService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('production') }
        }
      ]
    }).compile();

    controller = module.get(SessionsController);
  });

  describe('list', () => {
    it('maps the live rows and marks the session of the caller', async () => {
      const startedAt = new Date('2026-09-01T10:00:00.000Z');
      const createdAt = new Date('2026-09-20T08:30:00.000Z');
      refreshTokenService.findLiveSessions.mockResolvedValue([
        {
          sessionId: 'current-session',
          userAgent: 'Device-A',
          sessionStartedAt: startedAt,
          createdAt
        },
        {
          sessionId: 'other-session',
          userAgent: null,
          sessionStartedAt: startedAt,
          createdAt
        }
      ]);

      const result = await controller.list(jwtRequest());

      expect(refreshTokenService.findLiveSessions).toHaveBeenCalledWith(
        'user-1'
      );
      expect(result).toEqual([
        {
          id: 'current-session',
          current: true,
          userAgent: 'Device-A',
          startedAt: '2026-09-01T10:00:00.000Z',
          lastActiveAt: '2026-09-20T08:30:00.000Z'
        },
        {
          id: 'other-session',
          current: false,
          userAgent: null,
          startedAt: '2026-09-01T10:00:00.000Z',
          lastActiveAt: '2026-09-20T08:30:00.000Z'
        }
      ]);
    });
  });

  describe('revokeOne', () => {
    it('proves the caller with every factor it offered, bound to its operation', async () => {
      const res = mockResponse();

      await controller.revokeOne(
        'other-session',
        jwtRequest({ '__Host-reauth_proof': 'proof-token' }),
        { currentPassword: 'secret', code: '123456' },
        res
      );

      expect(authService.assertStepUp).toHaveBeenCalledWith(
        mockUser,
        'secret',
        'proof-token',
        STEP_UP_OPERATION.SESSION_REVOKE,
        '123456',
        { ip: '127.0.0.1', requestId: undefined }
      );
      expect(refreshTokenService.deleteUserSession).toHaveBeenCalledWith(
        'user-1',
        'other-session'
      );
      expect(res.clearCookie).toHaveBeenCalledWith('__Host-reauth_proof', {
        secure: true,
        path: '/'
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.SESSION_REVOKE,
          actorId: 'user-1',
          details: { scope: 'one', count: 1 }
        })
      );
    });

    it('ends nothing when the step-up refuses the caller', async () => {
      authService.assertStepUp.mockRejectedValue(
        new HttpException('refused', HttpStatus.BAD_REQUEST)
      );
      const res = mockResponse();

      await expect(
        controller.revokeOne('other-session', jwtRequest(), {}, res)
      ).rejects.toThrow('refused');

      expect(refreshTokenService.deleteUserSession).not.toHaveBeenCalled();
      expect(res.clearCookie).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('refuses the session of the caller before it spends any factor', async () => {
      await expect(
        controller.revokeOne(
          'current-session',
          jwtRequest(),
          { currentPassword: 'secret' },
          mockResponse()
        )
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: { errorKey: ErrorKeys.AUTH.SESSION_IS_CURRENT }
      });

      expect(authService.assertStepUp).not.toHaveBeenCalled();
      expect(refreshTokenService.deleteUserSession).not.toHaveBeenCalled();
    });

    it('answers 404 and keeps the proof cookie when no session was ended', async () => {
      refreshTokenService.deleteUserSession.mockResolvedValue(false);
      const res = mockResponse();

      await expect(
        controller.revokeOne(
          'unknown-session',
          jwtRequest(),
          { currentPassword: 'secret' },
          res
        )
      ).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
        response: { errorKey: ErrorKeys.AUTH.SESSION_NOT_FOUND }
      });

      expect(res.clearCookie).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  describe('revokeOthers', () => {
    it('keeps the session of the caller and audits the count', async () => {
      const res = mockResponse();

      const result = await controller.revokeOthers(
        jwtRequest(),
        { code: '123456' },
        res
      );

      expect(authService.assertStepUp).toHaveBeenCalledWith(
        mockUser,
        undefined,
        undefined,
        STEP_UP_OPERATION.SESSION_REVOKE,
        '123456',
        { ip: '127.0.0.1', requestId: undefined }
      );
      expect(refreshTokenService.deleteOtherSessions).toHaveBeenCalledWith(
        'user-1',
        'current-session'
      );
      expect(result.count).toBe(2);
      expect(res.clearCookie).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.SESSION_REVOKE,
          details: { scope: 'others', count: 2 }
        })
      );
    });

    it('ends nothing when the step-up refuses the caller', async () => {
      authService.assertStepUp.mockRejectedValue(
        new HttpException('refused', HttpStatus.BAD_REQUEST)
      );

      await expect(
        controller.revokeOthers(jwtRequest(), {}, mockResponse())
      ).rejects.toThrow('refused');
      expect(refreshTokenService.deleteOtherSessions).not.toHaveBeenCalled();
    });
  });
});
