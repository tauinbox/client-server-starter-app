// Regression guard: isActive/unlockAccount once had no class-validator
// decorators, so the forbidNonWhitelisted pipe 400-ed every admin
// deactivate/unlock request. Pipe options mirror main.ts.

import { Test } from '@nestjs/testing';
import {
  ValidationPipe,
  VersioningType,
  type INestApplication
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { NextFunction, Request, Response } from 'express';
import * as request from 'supertest';
import type { Server } from 'http';
import { UsersController } from '../src/modules/users/controllers/users.controller';
import { UsersService } from '../src/modules/users/services/users.service';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { CaslAbilityFactory } from '../src/modules/auth/casl/casl-ability.factory';
import { AuditService } from '../src/modules/audit/audit.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { PermissionsGuard } from '../src/modules/auth/guards/permissions.guard';

const TARGET_ID = '4f9d38f6-6c67-4a54-9d5e-111111111111';

describe('Admin user update DTO validation (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const usersService = {
    update: jest.fn()
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: PermissionService, useValue: {} },
        { provide: CaslAbilityFactory, useValue: {} },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: MetricsService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } }
      ]
    })
      .overrideGuard(PermissionsGuard)
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
        userId: 'admin-1',
        email: 'admin@example.com',
        roles: ['admin']
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
    ['isActive', { isActive: false }],
    ['unlockAccount', { unlockAccount: true }]
  ])('accepts %s (200) and dispatches the update', async (_field, payload) => {
    usersService.update.mockResolvedValue({ id: TARGET_ID });

    await request(server)
      .patch(`/api/v1/users/${TARGET_ID}`)
      .send(payload)
      .expect(200);

    expect(usersService.update).toHaveBeenCalledWith(
      TARGET_ID,
      payload,
      undefined
    );
  });

  it.each([
    ['isActive', { isActive: 'nope' }],
    ['unlockAccount', { unlockAccount: 'yes' }]
  ])('rejects a non-boolean %s (400)', async (field, payload) => {
    const res = await request(server)
      .patch(`/api/v1/users/${TARGET_ID}`)
      .send(payload)
      .expect(400);

    const body = res.body as { message: string[] };
    expect(body.message).toEqual(
      expect.arrayContaining([`${field} must be a boolean value`])
    );
    expect(usersService.update).not.toHaveBeenCalled();
  });

  it('still rejects an unknown property (400)', async () => {
    await request(server)
      .patch(`/api/v1/users/${TARGET_ID}`)
      .send({ tokenRevokedAt: new Date().toISOString() })
      .expect(400);

    expect(usersService.update).not.toHaveBeenCalled();
  });
});
