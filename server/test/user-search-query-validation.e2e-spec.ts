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
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { PermissionsGuard } from '../src/modules/auth/guards/permissions.guard';
import { MAX_USER_FILTER_LENGTH } from '@app/shared/constants/user.constants';

const EMPTY_PAGE = {
  data: [],
  meta: { page: 1, limit: 10, total: 0, totalPages: 0 }
};

const FILTER_FIELDS = ['q', 'email', 'firstName', 'lastName', 'role'] as const;

describe('User search query DTO validation (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const usersService = {
    findPaginated: jest.fn(),
    findCursorPaginated: jest.fn()
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    usersService.findPaginated.mockResolvedValue(EMPTY_PAGE);
    usersService.findCursorPaginated.mockResolvedValue(EMPTY_PAGE);

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

  it.each(FILTER_FIELDS)(
    'rejects an array-valued %s on GET /users/search (400)',
    async (field) => {
      const res = await request(server)
        .get(`/api/v1/users/search?${field}=a&${field}=b`)
        .expect(400);

      const body = res.body as { message: string[] };
      expect(body.message).toEqual(
        expect.arrayContaining([`${field} must be a string`])
      );
      expect(usersService.findPaginated).not.toHaveBeenCalled();
    }
  );

  it('rejects an array-valued q on GET /users (400)', async () => {
    await request(server).get('/api/v1/users?q=a&q=b').expect(400);

    expect(usersService.findPaginated).not.toHaveBeenCalled();
  });

  it.each([
    ['/api/v1/users/cursor?email=a&email=b'],
    ['/api/v1/users/search/cursor?role=a&role=b']
  ])('rejects an array-valued filter on cursor route %s (400)', async (url) => {
    await request(server).get(url).expect(400);

    expect(usersService.findCursorPaginated).not.toHaveBeenCalled();
  });

  it.each(FILTER_FIELDS)(
    'rejects an over-long %s on GET /users/search (400)',
    async (field) => {
      const res = await request(server)
        .get(
          `/api/v1/users/search?${field}=${'x'.repeat(MAX_USER_FILTER_LENGTH + 1)}`
        )
        .expect(400);

      const body = res.body as { message: string[] };
      expect(body.message).toEqual(
        expect.arrayContaining([
          `${field} must be shorter than or equal to ${MAX_USER_FILTER_LENGTH} characters`
        ])
      );
      expect(usersService.findPaginated).not.toHaveBeenCalled();
    }
  );

  it.each(['isActive', 'includeDeleted'])(
    'rejects a non-boolean %s instead of dropping the filter (400)',
    async (field) => {
      const res = await request(server)
        .get(`/api/v1/users/search?${field}=maybe`)
        .expect(400);

      const body = res.body as { message: string[] };
      expect(body.message).toEqual(
        expect.arrayContaining([`${field} must be a boolean value`])
      );
      expect(usersService.findPaginated).not.toHaveBeenCalled();
    }
  );

  it('reads an empty isActive as unset', async () => {
    await request(server).get('/api/v1/users/search?isActive=').expect(200);

    expect(usersService.findPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: undefined }),
      undefined
    );
  });

  it('accepts scalar filters and dispatches the search', async () => {
    await request(server)
      .get('/api/v1/users/search?q=alice&role=admin')
      .expect(200);

    expect(usersService.findPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'alice', role: 'admin' }),
      undefined
    );
  });
});
