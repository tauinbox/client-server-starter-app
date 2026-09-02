// Regression guard: PATCH /auth/profile rejects mass-assignment of privileged
// fields. Pins the ValidationPipe options mirrored from main.ts plus the
// narrow UpdateProfileDto; fails if either is widened. Auth (401) is covered
// by check-auth-coverage.

import { Test } from '@nestjs/testing';
import {
  ValidationPipe,
  VersioningType,
  type INestApplication
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import * as request from 'supertest';
import type { Server } from 'http';
import { AuthController } from '../src/modules/auth/controllers/auth.controller';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { MfaService } from '../src/modules/auth/services/mfa.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { CaslAbilityFactory } from '../src/modules/auth/casl/casl-ability.factory';
import { MfaPolicyService } from '../src/modules/auth/services/mfa-policy.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MailService } from '../src/modules/mail/mail.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { PermissionsGuard } from '../src/modules/auth/guards/permissions.guard';
import { MfaRequiredGuard } from '../src/modules/auth/guards/mfa-required.guard';
import { CaptchaRequiredGuard } from '../src/modules/auth/captcha/captcha-required.guard';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';

describe('Profile mass-assignment protection (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const usersService = {
    update: jest.fn(),
    findOne: jest.fn()
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        {
          // These suites never present a second factor. The mock answers the two
          // members AuthService and AuthController read, so the branch is simply
          // never taken.
          provide: MfaService,
          useValue: {
            isValidStepUpCode: jest.fn().mockReturnValue(false),
            issuePendingToken: jest
              .fn()
              .mockReturnValue({ mfaToken: 'mfa', expiresIn: 300 })
          }
        },
        { provide: UsersService, useValue: usersService },
        { provide: PermissionService, useValue: {} },
        { provide: CaslAbilityFactory, useValue: {} },
        {
          provide: MfaPolicyService,
          useValue: { appliesTo: jest.fn().mockResolvedValue(false) }
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: MailService,
          useValue: { sendPasswordChangedNotification: jest.fn() }
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: MetricsService, useValue: { recordAuthEvent: jest.fn() } },
        Reflector
      ]
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CaptchaRequiredGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(MfaRequiredGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      })
    );
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (
        req as Request & {
          user: { userId: string; email: string; roles: string[] };
        }
      ).user = {
        userId: 'user-1',
        email: 'user@example.com',
        roles: ['user']
      };
      next();
    });
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ['isActive', { firstName: 'x', isActive: true }],
    ['roles', { roles: ['admin'] }],
    ['failedLoginAttempts', { failedLoginAttempts: 0 }]
  ])(
    'rejects a payload containing the privileged field %s (400)',
    async (field, payload) => {
      const res = await request(server)
        .patch('/api/v1/auth/profile')
        .send(payload)
        .expect(400);

      const body = res.body as { message: string[] };
      expect(body.message).toEqual(
        expect.arrayContaining([`property ${field} should not exist`])
      );
      expect(usersService.update).not.toHaveBeenCalled();
    }
  );

  it('accepts a whitelisted payload (200) and dispatches the update', async () => {
    usersService.update.mockResolvedValue({ id: 'user-1', firstName: 'x' });

    const res = await request(server)
      .patch('/api/v1/auth/profile')
      .send({ firstName: 'x' })
      .expect(200);

    expect(res.body).toEqual({ id: 'user-1', firstName: 'x' });
    expect(usersService.update).toHaveBeenCalledWith(
      'user-1',
      { firstName: 'x' },
      SYSTEM_ABILITY
    );
  });
});
