// The percentage bucket hashes the flag key, so a rename would move users in
// and out of every rollout of the flag. Pipe options mirror main.ts.

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
import { FeatureFlagsAdminController } from '../src/modules/feature-flags/controllers/feature-flags-admin.controller';
import { FeatureFlagService } from '../src/modules/feature-flags/services/feature-flag.service';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { CaslAbilityFactory } from '../src/modules/auth/casl/casl-ability.factory';
import { AuditService } from '../src/modules/audit/audit.service';
import { PermissionsGuard } from '../src/modules/auth/guards/permissions.guard';
import { MfaRequiredGuard } from '../src/modules/auth/guards/mfa-required.guard';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import {
  AbilityBuilder,
  createMongoAbility
} from '../src/modules/auth/casl/app-ability';
import type { AppAbility } from '../src/modules/auth/casl/app-ability';

const FLAG_ID = '4f9d38f6-6c67-4a54-9d5e-222222222222';

describe('Feature flag key is immutable after create (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const flagService = {
    findOne: jest.fn(),
    update: jest.fn()
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      controllers: [FeatureFlagsAdminController],
      providers: [
        { provide: FeatureFlagService, useValue: flagService },
        { provide: PermissionService, useValue: {} },
        { provide: CaslAbilityFactory, useValue: {} },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: MetricsService,
          useValue: { recordPermissionDenied: jest.fn() }
        }
      ]
    })
      .overrideGuard(PermissionsGuard)
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
      const { can, build } = new AbilityBuilder<AppAbility>(
        createMongoAbility
      );
      can('update', 'FeatureFlag');
      Object.assign(req, { user: { userId: 'admin-1' }, ability: build() });
      next();
    });
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects a PATCH that carries a key (400) and writes nothing', async () => {
    const res = await request(server)
      .patch(`/api/v1/admin/feature-flags/${FLAG_ID}`)
      .set('If-Match', '1')
      .send({ key: 'renamed-flag', enabled: true })
      .expect(400);

    expect((res.body as { message: string[] }).message).toEqual([
      'property key should not exist'
    ]);
    expect(flagService.update).not.toHaveBeenCalled();
  });

  it('accepts a PATCH without a key (200)', async () => {
    flagService.findOne.mockResolvedValue({
      id: FLAG_ID,
      key: 'stable-flag',
      enabled: false,
      rules: []
    });
    flagService.update.mockResolvedValue({
      id: FLAG_ID,
      key: 'stable-flag',
      enabled: true,
      rules: []
    });

    await request(server)
      .patch(`/api/v1/admin/feature-flags/${FLAG_ID}`)
      .set('If-Match', '1')
      .send({ enabled: true })
      .expect(200);

    expect(flagService.update).toHaveBeenCalledWith(
      FLAG_ID,
      { enabled: true },
      1,
      'admin-1'
    );
  });
});
