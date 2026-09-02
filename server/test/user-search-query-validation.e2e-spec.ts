// Regression guard: the user-search filter params (q/email/firstName/
// lastName/role) once lacked @IsString(), so a duplicated query param
// (?q=a&q=b, parsed as an array) passed validation and crashed the
// service with a 500. Pipe options mirror main.ts.

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
import { MailService } from '../src/modules/mail/mail.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { PermissionsGuard } from '../src/modules/auth/guards/permissions.guard';
import { MfaRequiredGuard } from '../src/modules/auth/guards/mfa-required.guard';
import { MAX_USER_FILTER_LENGTH } from '@app/shared/constants';

const EMPTY_PAGE = {
  data: [],
  meta: { nextCursor: null, hasMore: false, limit: 20 }
};

const FILTER_FIELDS = ['q', 'email', 'firstName', 'lastName', 'role'] as const;

describe('User search query DTO validation (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const usersService = {
    findCursorPaginated: jest.fn()
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    usersService.findCursorPaginated.mockResolvedValue(EMPTY_PAGE);

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: PermissionService, useValue: {} },
        { provide: CaslAbilityFactory, useValue: {} },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: MailService,
          useValue: { sendPasswordChangedNotification: jest.fn() }
        },
        { provide: MetricsService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } }
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

  it.each(FILTER_FIELDS)(
    'rejects an array-valued %s on GET /users/search/cursor (400)',
    async (field) => {
      const res = await request(server)
        .get(`/api/v1/users/search/cursor?${field}=a&${field}=b`)
        .expect(400);

      const body = res.body as { message: string[] };
      expect(body.message).toEqual(
        expect.arrayContaining([`${field} must be a string`])
      );
      expect(usersService.findCursorPaginated).not.toHaveBeenCalled();
    }
  );

  it('rejects an array-valued q on GET /users/cursor (400)', async () => {
    await request(server).get('/api/v1/users/cursor?q=a&q=b').expect(400);

    expect(usersService.findCursorPaginated).not.toHaveBeenCalled();
  });

  it.each(FILTER_FIELDS)(
    'rejects an over-long %s on GET /users/search/cursor (400)',
    async (field) => {
      const res = await request(server)
        .get(
          `/api/v1/users/search/cursor?${field}=${'x'.repeat(MAX_USER_FILTER_LENGTH + 1)}`
        )
        .expect(400);

      const body = res.body as { message: string[] };
      expect(body.message).toEqual(
        expect.arrayContaining([
          `${field} must be shorter than or equal to ${MAX_USER_FILTER_LENGTH} characters`
        ])
      );
      expect(usersService.findCursorPaginated).not.toHaveBeenCalled();
    }
  );

  it.each(['isActive', 'includeDeleted'])(
    'rejects a non-boolean %s instead of dropping the filter (400)',
    async (field) => {
      const res = await request(server)
        .get(`/api/v1/users/search/cursor?${field}=maybe`)
        .expect(400);

      const body = res.body as { message: string[] };
      expect(body.message).toEqual(
        expect.arrayContaining([`${field} must be a boolean value`])
      );
      expect(usersService.findCursorPaginated).not.toHaveBeenCalled();
    }
  );

  it('reads an empty isActive as unset', async () => {
    await request(server)
      .get('/api/v1/users/search/cursor?isActive=')
      .expect(200);

    expect(usersService.findCursorPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: undefined }),
      undefined
    );
  });

  it('accepts scalar filters and dispatches the search', async () => {
    await request(server)
      .get('/api/v1/users/search/cursor?q=alice&role=admin')
      .expect(200);

    expect(usersService.findCursorPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'alice', role: 'admin' }),
      undefined
    );
  });
});
