import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Request as ExpressRequest, Response } from 'express';
import { ErrorKeys } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { MfaController } from './mfa.controller';
import { AuthService } from '../services/auth.service';
import { MfaService } from '../services/mfa.service';
import { UsersService } from '../../users/services/users.service';
import { AuditService } from '../../audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { User } from '../../users/entities/user.entity';
import { JwtAuthRequest } from '../types/auth.request';
import { createMockRequest } from '../../../common/testing/express.mock';

type MockedResponse = { cookie: jest.Mock; clearCookie: jest.Mock };

function mockResponse(): MockedResponse & Response {
  return { cookie: jest.fn(), clearCookie: jest.fn() } as MockedResponse &
    Response;
}

const mockUser = { id: 'user-1', email: 'user@example.com' } as User;

function jwtRequest(cookies: Record<string, string> = {}): JwtAuthRequest {
  return createMockRequest({
    user: { userId: 'user-1', email: 'user@example.com', roles: ['user'] },
    ip: '127.0.0.1',
    headers: {},
    cookies
  });
}

function publicRequest(): ExpressRequest {
  return createMockRequest({ ip: '127.0.0.1', headers: {}, cookies: {} });
}

describe('MfaController', () => {
  let controller: MfaController;
  let authService: { assertStepUp: jest.Mock; login: jest.Mock };
  let mfaService: {
    beginEnrolment: jest.Mock;
    completeEnrolment: jest.Mock;
    disable: jest.Mock;
    verifyChallenge: jest.Mock;
    consumeRecoveryCode: jest.Mock;
  };
  let auditService: { log: jest.Mock };
  let metricsService: { recordAuthEvent: jest.Mock };
  let res: MockedResponse & Response;

  beforeEach(async () => {
    authService = {
      assertStepUp: jest.fn().mockResolvedValue(undefined),
      login: jest.fn().mockResolvedValue({
        tokens: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600
        },
        user: mockUser
      })
    };
    mfaService = {
      beginEnrolment: jest.fn().mockResolvedValue({
        secret: 'SECRET',
        otpauthUri: 'otpauth://totp/Nexus:user@example.com?secret=SECRET',
        qrDataUrl: 'data:image/png;base64,AAAA'
      }),
      completeEnrolment: jest
        .fn()
        .mockResolvedValue({ recoveryCodes: ['ABCDEFGH-IJKLMNOP'] }),
      disable: jest.fn().mockResolvedValue(undefined),
      verifyChallenge: jest.fn().mockResolvedValue(mockUser),
      consumeRecoveryCode: jest.fn().mockResolvedValue(mockUser)
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    metricsService = { recordAuthEvent: jest.fn() };
    res = mockResponse();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MfaController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: MfaService, useValue: mfaService },
        {
          provide: UsersService,
          useValue: { findOne: jest.fn().mockResolvedValue(mockUser) }
        },
        { provide: AuditService, useValue: auditService },
        { provide: MetricsService, useValue: metricsService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('development'),
            getOrThrow: jest.fn().mockReturnValue('604800')
          }
        }
      ]
    }).compile();

    controller = module.get<MfaController>(MfaController);
  });

  describe('setup', () => {
    it('demands a fresh proof of identity before it enrols a device', async () => {
      // A stolen session that could enrol its own authenticator would lock the
      // owner out of their own account.
      await controller.setup(jwtRequest(), { currentPassword: 'Password1' });

      expect(authService.assertStepUp).toHaveBeenCalledWith(
        mockUser,
        'Password1',
        undefined
      );
      expect(mfaService.beginEnrolment).toHaveBeenCalledWith(mockUser);
    });

    it('passes the re-authentication proof cookie through', async () => {
      await controller.setup(jwtRequest({ reauth_proof: 'proof' }), {});

      expect(authService.assertStepUp).toHaveBeenCalledWith(
        mockUser,
        undefined,
        'proof'
      );
    });

    it('does not enrol when the step-up fails', async () => {
      authService.assertStepUp.mockRejectedValue(
        new HttpException(
          { errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD },
          HttpStatus.BAD_REQUEST
        )
      );

      await expect(controller.setup(jwtRequest(), {})).rejects.toMatchObject({
        status: 400
      });
      expect(mfaService.beginEnrolment).not.toHaveBeenCalled();
    });
  });

  describe('enable', () => {
    it('returns the recovery codes for a correct code', async () => {
      const result = await controller.enable(jwtRequest(), { code: '123456' });

      expect(result).toEqual({ recoveryCodes: ['ABCDEFGH-IJKLMNOP'] });
      expect(mfaService.completeEnrolment).toHaveBeenCalledWith(
        mockUser,
        '123456',
        expect.objectContaining({ ip: '127.0.0.1' })
      );
    });
  });

  describe('disable', () => {
    it('accepts an authenticator code in place of the password', async () => {
      await controller.disable(jwtRequest(), { code: '123456' });

      expect(authService.assertStepUp).toHaveBeenCalledWith(
        mockUser,
        undefined,
        undefined,
        '123456'
      );
      expect(mfaService.disable).toHaveBeenCalled();
    });

    it('does not turn the factor off when the step-up fails', async () => {
      authService.assertStepUp.mockRejectedValue(
        new HttpException({}, HttpStatus.BAD_REQUEST)
      );

      await expect(controller.disable(jwtRequest(), {})).rejects.toBeDefined();
      expect(mfaService.disable).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it('issues the session the password alone did not buy', async () => {
      const result = await controller.verify(
        publicRequest(),
        { mfaToken: 'pending', code: '123456' },
        res
      );

      expect(result).toEqual({
        tokens: { access_token: 'access-token', expires_in: 3600 },
        user: mockUser
      });
      expect(result.tokens).not.toHaveProperty('refresh_token');
    });

    it('sets the refresh cookie only at this point', async () => {
      await controller.verify(
        publicRequest(),
        { mfaToken: 'pending', code: '123456' },
        res
      );

      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-token',
        expect.objectContaining({ httpOnly: true, path: '/api/v1/auth' })
      );
    });

    it('records the sign-in as complete only after the second factor', async () => {
      await controller.verify(
        publicRequest(),
        { mfaToken: 'pending', code: '123456' },
        res
      );

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_LOGIN_SUCCESS,
          details: { factor: 'mfa' }
        })
      );
      expect(metricsService.recordAuthEvent).toHaveBeenCalledWith(
        'login_success'
      );
    });

    it('issues no session when the code is refused', async () => {
      mfaService.verifyChallenge.mockRejectedValue(
        new HttpException(
          { errorKey: ErrorKeys.AUTH.MFA_INVALID_CODE },
          HttpStatus.UNAUTHORIZED
        )
      );

      await expect(
        controller.verify(
          publicRequest(),
          { mfaToken: 'pending', code: '000000' },
          res
        )
      ).rejects.toMatchObject({ status: 401 });
      expect(res.cookie).not.toHaveBeenCalled();
      expect(authService.login).not.toHaveBeenCalled();
    });
  });

  describe('recovery', () => {
    it('signs the account in with a recovery code', async () => {
      const result = await controller.recovery(
        publicRequest(),
        { mfaToken: 'pending', recoveryCode: 'ABCDEFGH-IJKLMNOP' },
        res
      );

      expect(mfaService.consumeRecoveryCode).toHaveBeenCalledWith(
        'pending',
        'ABCDEFGH-IJKLMNOP',
        expect.objectContaining({ ip: '127.0.0.1' })
      );
      expect(result.user).toBe(mockUser);
      expect(res.cookie).toHaveBeenCalled();
    });
  });
});
