// Integration regression for BKL-026 — type-level @Authorize bypass on
// single-entity endpoints. Conditional CASL rules (e.g. `read:User` with
// `{ id: '${user.id}' }`) pass the type-level check but MUST be re-evaluated
// against the loaded entity, otherwise any conditional grant becomes an
// unconditional grant on the affected endpoint.
//
// Drives full HTTP path against each affected controller with a real
// MongoAbility built via AbilityBuilder + condition resolvers analogous to
// the production CASL factory.

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  Module
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import type { Subjects } from '../src/modules/auth/casl/app-ability';
import * as request from 'supertest';
import { Server } from 'http';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../src/modules/auth/guards/permissions.guard';
import { UsersController } from '../src/modules/users/controllers/users.controller';
import { RolesController } from '../src/modules/auth/controllers/roles.controller';
import { RbacController } from '../src/modules/auth/controllers/rbac.controller';
import { UsersService } from '../src/modules/users/services/users.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { ResourceService } from '../src/modules/auth/services/resource.service';
import { ActionService } from '../src/modules/auth/services/action.service';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { CaslAbilityFactory } from '../src/modules/auth/casl/casl-ability.factory';
import { AuditService } from '../src/modules/audit/audit.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { AppAbility } from '../src/modules/auth/casl/app-ability';
import type { JwtAuthRequest } from '../src/modules/auth/types/auth.request';

// ── Per-test ability container ──────────────────────────────────────
// A single mutable holder lets each test build the ability it wants
// and have the test-time guard read it on every request.
class AbilityHolder {
  current: AppAbility | undefined;
}

@Injectable()
class TestJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<JwtAuthRequest>();
    req.user = {
      userId: 'test-actor',
      email: 'actor@example.com',
      roles: ['user']
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

interface FixtureMocks {
  usersService: {
    findOne: jest.Mock;
  };
  roleService: {
    findOne: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    getPermissionsForRole: jest.Mock;
  };
  resourceService: {
    findOne: jest.Mock;
    update: jest.Mock;
    restore: jest.Mock;
  };
  actionService: {
    findOne: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
}

describe('Instance-level @Authorize re-check (BKL-026)', () => {
  let app: INestApplication;
  let mocks: FixtureMocks;
  let holder: AbilityHolder;

  beforeAll(async () => {
    mocks = {
      usersService: {
        findOne: jest.fn()
      },
      roleService: {
        findOne: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        getPermissionsForRole: jest.fn().mockResolvedValue([])
      },
      resourceService: {
        findOne: jest.fn(),
        update: jest.fn(),
        restore: jest.fn()
      },
      actionService: {
        findOne: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      }
    };

    holder = new AbilityHolder();

    @Module({
      controllers: [UsersController, RolesController, RbacController],
      providers: [
        { provide: AbilityHolder, useValue: holder },
        { provide: APP_GUARD, useClass: TestJwtAuthGuard },
        { provide: APP_GUARD, useClass: TestPermissionsGuard },
        { provide: UsersService, useValue: mocks.usersService },
        { provide: RoleService, useValue: mocks.roleService },
        { provide: ResourceService, useValue: mocks.resourceService },
        { provide: ActionService, useValue: mocks.actionService },
        {
          provide: PermissionService,
          useValue: {
            getRolesForUser: jest.fn().mockResolvedValue([]),
            getPermissionsForUser: jest.fn().mockResolvedValue([])
          }
        },
        {
          provide: CaslAbilityFactory,
          useValue: {
            createForUser: jest.fn().mockResolvedValue({ rules: [] })
          }
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn().mockResolvedValue(undefined),
            logFireAndForget: jest.fn()
          }
        },
        {
          provide: MetricsService,
          useValue: { recordPermissionDenied: jest.fn() }
        },
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
      // Override the production-wired guards in CoreModule so test-time
      // analogues run instead. We do not import CoreModule here; the
      // overrideGuard calls neutralize the symbols if they get pulled in
      // transitively.
      .overrideGuard(JwtAuthGuard)
      .useClass(TestJwtAuthGuard)
      .overrideGuard(PermissionsGuard)
      .useClass(TestPermissionsGuard)
      .compile();

    app = moduleRef.createNestApplication();
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

  // Build an AppAbility from a single rule. The condition is a plain
  // MongoQuery and is evaluated by CASL only when a subject INSTANCE is
  // passed (i.e. ability.can('read', subject('User', user))).
  function abilityWithRule(
    action: string,
    subjectName: string,
    conditions?: Record<string, unknown>
  ): AppAbility {
    const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
    builder.can(action, subjectName as Extract<Subjects, string>, conditions);
    return builder.build();
  }

  // ── Users: GET /users/:id ────────────────────────────────────────

  describe('GET /api/v1/users/:id with conditional read:User ownership rule', () => {
    const SELF_ID = '11111111-1111-1111-1111-111111111111';
    const OTHER_ID = '22222222-2222-2222-2222-222222222222';

    beforeEach(() => {
      mocks.usersService.findOne.mockImplementation((id: string) => {
        if (id === SELF_ID) return Promise.resolve({ id: SELF_ID });
        if (id === OTHER_ID) return Promise.resolve({ id: OTHER_ID });
        return Promise.reject(new Error('not found'));
      });
      // CASL rule allowing read of users where id matches the caller's id.
      // Type-level ability.can('read', 'User') returns true (any allow rule
      // for the type passes). Instance-level ability.can('read',
      // subject('User', user)) evaluates the condition.
      holder.current = abilityWithRule('read', 'User', { id: 'test-actor' });
    });

    it('returns 403 for OTHER user (instance check fails)', async () => {
      await request(http()).get(`/users/${OTHER_ID}`).expect(403);
    });

    it('allows reading own profile when id matches the condition', async () => {
      holder.current = abilityWithRule('read', 'User', { id: SELF_ID });
      await request(http()).get(`/users/${SELF_ID}`).expect(200);
    });
  });

  // ── Roles: GET /roles/:id ────────────────────────────────────────

  describe('GET /api/v1/roles/:id with fieldMatch isSystem=false', () => {
    const SYSTEM_ROLE = '33333333-3333-3333-3333-333333333333';
    const CUSTOM_ROLE = '44444444-4444-4444-4444-444444444444';

    beforeEach(() => {
      mocks.roleService.findOne.mockImplementation((id: string) => {
        if (id === SYSTEM_ROLE)
          return Promise.resolve({
            id: SYSTEM_ROLE,
            name: 'admin',
            isSystem: true
          });
        if (id === CUSTOM_ROLE)
          return Promise.resolve({
            id: CUSTOM_ROLE,
            name: 'editor',
            isSystem: false
          });
        return Promise.reject(new Error('not found'));
      });
      holder.current = abilityWithRule('read', 'Role', { isSystem: false });
    });

    it('returns 403 for a system role (instance check fails)', async () => {
      await request(http()).get(`/roles/${SYSTEM_ROLE}`).expect(403);
    });

    it('returns 200 for a non-system role (instance check passes)', async () => {
      await request(http()).get(`/roles/${CUSTOM_ROLE}`).expect(200);
    });
  });

  describe('PATCH /api/v1/roles/:id with conditional update rule', () => {
    const ROLE_A = '55555555-5555-5555-5555-555555555555';
    const ROLE_B = '66666666-6666-6666-6666-666666666666';

    beforeEach(() => {
      mocks.roleService.findOne.mockImplementation((id: string) => {
        if (id === ROLE_A)
          return Promise.resolve({ id: ROLE_A, name: 'editor-a' });
        if (id === ROLE_B)
          return Promise.resolve({ id: ROLE_B, name: 'editor-b' });
        return Promise.reject(new Error('not found'));
      });
      mocks.roleService.update.mockResolvedValue({ id: ROLE_A });
      // Allow update only on the role named 'editor-a'.
      holder.current = abilityWithRule('update', 'Role', { name: 'editor-a' });
    });

    it('returns 403 when patching a role that does not satisfy the condition', async () => {
      await request(http())
        .patch(`/roles/${ROLE_B}`)
        .send({ description: 'x' })
        .expect(403);
      expect(mocks.roleService.update).not.toHaveBeenCalled();
    });

    it('returns 200 when patching a role that satisfies the condition', async () => {
      await request(http())
        .patch(`/roles/${ROLE_A}`)
        .send({ description: 'x' })
        .expect(200);
      expect(mocks.roleService.update).toHaveBeenCalledWith(
        ROLE_A,
        expect.objectContaining({ description: 'x' })
      );
    });
  });

  // ── RBAC actions: PATCH /rbac/actions/:id ───────────────────────

  describe('PATCH /api/v1/rbac/actions/:id with fieldMatch isDefault=false', () => {
    const DEFAULT_ACTION = '77777777-7777-7777-7777-777777777777';
    const CUSTOM_ACTION = '88888888-8888-8888-8888-888888888888';

    beforeEach(() => {
      mocks.actionService.findOne.mockImplementation((id: string) => {
        if (id === DEFAULT_ACTION)
          return Promise.resolve({
            id: DEFAULT_ACTION,
            name: 'read',
            isDefault: true
          });
        if (id === CUSTOM_ACTION)
          return Promise.resolve({
            id: CUSTOM_ACTION,
            name: 'export',
            isDefault: false
          });
        return Promise.reject(new Error('not found'));
      });
      mocks.actionService.update.mockResolvedValue({ id: CUSTOM_ACTION });
      holder.current = abilityWithRule('update', 'Permission', {
        isDefault: false
      });
    });

    it('returns 403 when updating a default action (instance check fails)', async () => {
      await request(http())
        .patch(`/rbac/actions/${DEFAULT_ACTION}`)
        .send({ displayName: 'Read' })
        .expect(403);
      expect(mocks.actionService.update).not.toHaveBeenCalled();
    });

    it('returns 200 when updating a non-default action', async () => {
      await request(http())
        .patch(`/rbac/actions/${CUSTOM_ACTION}`)
        .send({ displayName: 'Export Data' })
        .expect(200);
      expect(mocks.actionService.update).toHaveBeenCalled();
    });
  });
});
