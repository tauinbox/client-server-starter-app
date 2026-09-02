// Integration proof that the enrolment requirement travels with @Authorize.
// A unit test of MfaRequiredGuard cannot show that the decorator applies it,
// which is the whole mechanism: the protected surface is defined as "every
// route the decorator carries", so the decorator is what has to be exercised.

import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  Module
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as request from 'supertest';
import { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { Authorize } from '../src/modules/auth/decorators/authorize.decorator';
import { SkipMfaEnrolmentGate } from '../src/modules/auth/decorators/skip-mfa-enrolment-gate.decorator';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../src/modules/auth/guards/permissions.guard';
import { MfaPolicyService } from '../src/modules/auth/services/mfa-policy.service';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { SecretEncryptionService } from '../src/common/crypto/secret-encryption.service';
import { createMockConfigService } from '../src/common/testing/config-service.mock';
import { User } from '../src/modules/users/entities/user.entity';
import type { JwtAuthRequest } from '../src/modules/auth/types/auth.request';

const ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');

@Injectable()
class TestJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<JwtAuthRequest>();
    req.user = {
      userId: 'admin-1',
      email: 'admin@example.com',
      roles: ['admin']
    };
    return true;
  }
}

@Injectable()
class AllowAllPermissionsGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Controller('mfa-gate')
class ProbeController {
  @Get('protected')
  @Authorize(['read', 'Role'])
  protectedRoute() {
    return { reached: true };
  }

  @Get('open')
  openRoute() {
    return { reached: true };
  }

  @Get('self-service')
  @Authorize(['update', 'Profile'])
  @SkipMfaEnrolmentGate()
  selfServiceRoute() {
    return { reached: true };
  }
}

describe('Two-factor requirement on the @Authorize surface (e2e)', () => {
  let app: INestApplication;
  const roles = { getRolesForUser: jest.fn() };
  const userRepository = { findOne: jest.fn() };

  beforeAll(async () => {
    const config = createMockConfigService({
      MFA_ENCRYPTION_KEY: ENCRYPTION_KEY,
      MFA_REQUIRED_FOR_ADMINS: 'true'
    });

    @Module({
      controllers: [ProbeController],
      providers: [
        MfaPolicyService,
        SecretEncryptionService,
        { provide: ConfigService, useValue: config },
        { provide: PermissionService, useValue: roles },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: APP_GUARD, useClass: TestJwtAuthGuard }
      ]
    })
    class TestAppModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule]
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(TestJwtAuthGuard)
      .overrideGuard(PermissionsGuard)
      .useClass(AllowAllPermissionsGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  it('refuses a super role that owes an enrolment', async () => {
    roles.getRolesForUser.mockResolvedValue([{ name: 'admin', isSuper: true }]);
    userRepository.findOne.mockResolvedValue({
      id: 'admin-1',
      totpEnabledAt: null
    });

    const res = await request(http()).get('/mfa-gate/protected').expect(403);
    const body = res.body as { errorKey: string };

    expect(body.errorKey).toBe(ErrorKeys.AUTH.MFA_ENROLMENT_REQUIRED);
  });

  it('admits the same account once the factor is on', async () => {
    roles.getRolesForUser.mockResolvedValue([{ name: 'admin', isSuper: true }]);
    userRepository.findOne.mockResolvedValue({
      id: 'admin-1',
      totpEnabledAt: new Date()
    });

    await request(http()).get('/mfa-gate/protected').expect(200);
  });

  it('leaves an account without a super role alone', async () => {
    roles.getRolesForUser.mockResolvedValue([
      { name: 'editor', isSuper: false }
    ]);

    await request(http()).get('/mfa-gate/protected').expect(200);
    expect(userRepository.findOne).not.toHaveBeenCalled();
  });

  it('keeps a self-service route open, so a password can still be set', async () => {
    roles.getRolesForUser.mockResolvedValue([{ name: 'admin', isSuper: true }]);
    userRepository.findOne.mockResolvedValue({
      id: 'admin-1',
      totpEnabledAt: null
    });

    await request(http()).get('/mfa-gate/self-service').expect(200);
  });

  it('does not touch a route the decorator never carried', async () => {
    roles.getRolesForUser.mockResolvedValue([{ name: 'admin', isSuper: true }]);
    userRepository.findOne.mockResolvedValue({
      id: 'admin-1',
      totpEnabledAt: null
    });

    await request(http()).get('/mfa-gate/open').expect(200);
  });
});
