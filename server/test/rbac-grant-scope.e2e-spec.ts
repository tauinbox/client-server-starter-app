/**
 * The unit and service specs never prove the escalation is blocked at the
 * route. The real `RoleService` runs here - only the repositories are mocked -
 * so a request travels controller -> assertGrantAllowed ->
 * assertCanGrantPermissions as it does in production, against an ability built
 * through the production condition resolver.
 */

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  Module,
  ValidationPipe
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import * as request from 'supertest';
import { Server } from 'http';
import { Logger } from '@nestjs/common';
import type { PermissionCondition } from '@app/shared/types';
import { ErrorKeys } from '@app/shared/constants';
import {
  AbilityBuilder,
  createMongoAbility,
  type AppAbility,
  type Subjects
} from '../src/modules/auth/casl/app-ability';
import { resolveConditions } from '../src/modules/auth/casl/resolve-conditions';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { MfaRequiredGuard } from '../src/modules/auth/guards/mfa-required.guard';
import { PermissionsGuard } from '../src/modules/auth/guards/permissions.guard';
import { RolesController } from '../src/modules/auth/controllers/roles.controller';
import { RoleService } from '../src/modules/auth/services/role.service';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { Role } from '../src/modules/auth/entities/role.entity';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { RolePermission } from '../src/modules/auth/entities/role-permission.entity';
import type { JwtAuthRequest } from '../src/modules/auth/types/auth.request';

const ACTOR_ID = 'delegated-admin-id';
const TARGET_ROLE_ID = '11111111-1111-4111-8111-111111111111';
const PERMISSION_ID = '22222222-2222-4222-8222-222222222222';

class AbilityHolder {
  current: AppAbility | undefined;
}

@Injectable()
class TestJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<JwtAuthRequest>();
    req.user = {
      userId: ACTOR_ID,
      email: 'delegated@example.com',
      roles: ['delegated-admin']
    };
    return true;
  }
}

@Injectable()
class TestPermissionsGuard implements CanActivate {
  constructor(private readonly holder: AbilityHolder) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<JwtAuthRequest>();
    if (this.holder.current) {
      req.ability = this.holder.current;
    }
    return true;
  }
}

const logger = new Logger('rbac-grant-scope.e2e');

/** Builds the caller's ability the way CaslAbilityFactory does. */
function abilityWith(conditions: PermissionCondition | null): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  const subject = 'User' as Extract<Subjects, string>;
  if (!conditions) {
    can('update', subject);
  } else {
    const { query } = resolveConditions(conditions, {
      userId: ACTOR_ID,
      permissionLabel: 'update:User',
      logger
    });
    can('update', subject, query);
  }
  // Needed to get past the controller's own `update:Role` authorization and
  // the service's instance check on the target role.
  can('update', 'Role' as Extract<Subjects, string>);
  return build();
}

describe('Grant scope over the HTTP path', () => {
  let app: INestApplication;
  let holder: AbilityHolder;
  let rolePermissionRepo: { save: jest.Mock; create: jest.Mock };
  let auditService: { logFireAndForget: jest.Mock; log: jest.Mock };

  beforeAll(async () => {
    holder = new AbilityHolder();

    const customRole = {
      id: TARGET_ROLE_ID,
      name: 'target-role',
      isSystem: false,
      isSuper: false
    };

    const permission = {
      id: PERMISSION_ID,
      action: { name: 'update' },
      resource: { subject: 'User', name: 'User' }
    };

    rolePermissionRepo = {
      save: jest.fn().mockResolvedValue([]),
      create: jest.fn((v: unknown) => v)
    };
    auditService = {
      logFireAndForget: jest.fn(),
      log: jest.fn().mockResolvedValue(undefined)
    };

    @Module({
      controllers: [RolesController],
      providers: [
        RoleService,
        { provide: AbilityHolder, useValue: holder },
        { provide: APP_GUARD, useClass: TestJwtAuthGuard },
        { provide: APP_GUARD, useClass: TestPermissionsGuard },
        {
          provide: getRepositoryToken(Role),
          useValue: {
            findOne: jest.fn().mockResolvedValue(customRole),
            // `invalidateUsersWithRole` runs after a successful write and goes
            // through the entity manager, not the repository.
            manager: {
              createQueryBuilder: jest.fn(() => ({
                select: jest.fn().mockReturnThis(),
                innerJoin: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([])
              }))
            }
          }
        },
        {
          provide: getRepositoryToken(Permission),
          useValue: { find: jest.fn().mockResolvedValue([permission]) }
        },
        {
          provide: getRepositoryToken(RolePermission),
          useValue: rolePermissionRepo
        },
        {
          provide: PermissionService,
          useValue: {
            invalidateUserCache: jest.fn().mockResolvedValue(undefined),
            getRolesForUser: jest.fn().mockResolvedValue([]),
            getPermissionsForUser: jest.fn().mockResolvedValue([])
          }
        },
        { provide: AuditService, useValue: auditService },
        {
          provide: MetricsService,
          useValue: { recordPermissionDenied: jest.fn() }
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined)
          }
        }
      ]
    })
    class TestAppModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule]
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(TestJwtAuthGuard)
      .overrideGuard(PermissionsGuard)
      .useClass(TestPermissionsGuard)
      .overrideGuard(MfaRequiredGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    // Mirrors the production pipe in main.ts so DTO rejections are identical.
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      })
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
    holder.current = undefined;
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  function assignPermissions(conditions?: PermissionCondition) {
    return request(http())
      .post(`/roles/${TARGET_ROLE_ID}/permissions`)
      .send({
        permissionIds: [PERMISSION_ID],
        ...(conditions ? { conditions } : {})
      });
  }

  const OWNERSHIP: PermissionCondition = { ownership: { userField: 'id' } };

  describe('caller holds update:User only over themselves', () => {
    beforeEach(() => {
      holder.current = abilityWith(OWNERSHIP);
    });

    it('rejects a broader condition with 403 and the dedicated key', async () => {
      const res = await assignPermissions({
        fieldMatch: { isActive: [true] }
      });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        errorKey: ErrorKeys.ROLES.CONDITION_BROADER_THAN_CALLER
      });
      expect(rolePermissionRepo.save).not.toHaveBeenCalled();
    });

    it('records the denial in the audit trail', async () => {
      await assignPermissions({ fieldMatch: { isActive: [true] } });

      expect(auditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PERMISSION_GRANT_DENIED',
          actorId: ACTOR_ID,
          targetId: TARGET_ROLE_ID
        })
      );
    });

    it('rejects an omitted condition with 403', async () => {
      const res = await assignPermissions();

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        errorKey: ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION
      });
      expect(rolePermissionRepo.save).not.toHaveBeenCalled();
    });

    it('allows an equal condition', async () => {
      const res = await assignPermissions(OWNERSHIP);

      expect(res.status).toBe(201);
      expect(rolePermissionRepo.save).toHaveBeenCalled();
    });

    it('allows a stricter condition', async () => {
      const res = await assignPermissions({
        ownership: { userField: 'id' },
        fieldMatch: { isActive: [true] }
      });

      expect(res.status).toBe(201);
      expect(rolePermissionRepo.save).toHaveBeenCalled();
    });
  });

  describe('caller holds update:User unconditionally', () => {
    it('is unaffected by the rule', async () => {
      holder.current = abilityWith(null);

      const res = await assignPermissions({
        fieldMatch: { isActive: [true] }
      });

      expect(res.status).toBe(201);
      expect(rolePermissionRepo.save).toHaveBeenCalled();
    });
  });
});
