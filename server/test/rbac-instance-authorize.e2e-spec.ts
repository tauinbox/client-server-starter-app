// A conditional grant passes the type-level @Authorize check, so the record
// must be checked too. The HTTP path runs through each controller and the REAL
// service that does the check; only the repositories are stubbed.

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  Module
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import { DataSource } from 'typeorm';
import type { Subjects } from '../src/modules/auth/casl/app-ability';
import request from 'supertest';
import { Server } from 'http';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { MfaRequiredGuard } from '../src/modules/auth/guards/mfa-required.guard';
import { PermissionsGuard } from '../src/modules/auth/guards/permissions.guard';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { MfaService } from '../src/modules/auth/services/mfa.service';
import { UsersController } from '../src/modules/users/controllers/users.controller';
import { RESPONSE_SERIALIZER } from '../src/modules/core/interceptors/response-serializer.provider';
import { RolesController } from '../src/modules/auth/controllers/roles.controller';
import { RbacController } from '../src/modules/auth/controllers/rbac.controller';
import { UsersService } from '../src/modules/users/services/users.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { ResourceService } from '../src/modules/auth/services/resource.service';
import { ResourceRegistryService } from '../src/modules/auth/services/resource-registry.service';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { BreachedPasswordService } from '../src/modules/auth/breached-password/breached-password.service';
import { CaslAbilityFactory } from '../src/modules/auth/casl/casl-ability.factory';
import { AuditService } from '../src/modules/audit/audit.service';
import { MailService } from '../src/modules/mail/mail.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { User } from '../src/modules/users/entities/user.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { RolePermission } from '../src/modules/auth/entities/role-permission.entity';
import { Resource } from '../src/modules/auth/entities/resource.entity';
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
      roles: ['user'],
      sessionId: 'session-1'
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

/** Rows that the stubbed `findOne` of a repository answers, by id. */
type Rows = Map<string, Record<string, unknown>>;

function repositoryOf(rows: Rows, save: jest.Mock) {
  return {
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(rows.get(where.id) ?? null)
    ),
    manager: {
      transaction: jest.fn((work: (em: unknown) => Promise<unknown>) =>
        work({
          save: (...args: unknown[]): unknown => save(args[args.length - 1])
        })
      )
    }
  };
}

describe('Instance-level @Authorize re-check', () => {
  let app: INestApplication;
  let holder: AbilityHolder;
  const userRows: Rows = new Map();
  const roleRows: Rows = new Map();
  const resourceRows: Rows = new Map();
  // Every write of the three services goes through the transaction manager
  // above, so one spy shows whether a refused request wrote anything.
  const save = jest.fn((entity: unknown) => Promise.resolve(entity));

  beforeAll(async () => {
    holder = new AbilityHolder();

    @Module({
      controllers: [UsersController, RolesController, RbacController],
      providers: [
        RESPONSE_SERIALIZER,
        UsersService,
        RoleService,
        ResourceService,
        // Stubbed: the step-up has its own suite, user-credential-step-up.
        { provide: AuthService, useValue: { assertStepUp: jest.fn() } },
        { provide: MfaService, useValue: {} },
        { provide: AbilityHolder, useValue: holder },
        { provide: APP_GUARD, useClass: TestJwtAuthGuard },
        { provide: APP_GUARD, useClass: TestPermissionsGuard },
        {
          provide: getRepositoryToken(User),
          useValue: repositoryOf(userRows, save)
        },
        {
          provide: getRepositoryToken(Role),
          useValue: repositoryOf(roleRows, save)
        },
        {
          provide: getRepositoryToken(Resource),
          useValue: repositoryOf(resourceRows, save)
        },
        { provide: getRepositoryToken(Permission), useValue: {} },
        { provide: getRepositoryToken(RolePermission), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: BreachedPasswordService, useValue: {} },
        {
          provide: ResourceRegistryService,
          useValue: { isRegistered: () => true }
        },
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
          provide: MailService,
          useValue: { sendPasswordChangedNotification: jest.fn() }
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
      .overrideGuard(MfaRequiredGuard)
      .useValue({ canActivate: () => true })
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
    userRows.clear();
    roleRows.clear();
    resourceRows.clear();
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
    const SELF_ID = '11111111-1111-4111-8111-111111111111';
    const OTHER_ID = '22222222-2222-4222-8222-222222222222';

    beforeEach(() => {
      userRows.set(SELF_ID, { id: SELF_ID, roles: [] });
      userRows.set(OTHER_ID, { id: OTHER_ID, roles: [] });
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
    const SYSTEM_ROLE = '33333333-3333-4333-8333-333333333333';
    const CUSTOM_ROLE = '44444444-4444-4444-8444-444444444444';

    beforeEach(() => {
      roleRows.set(SYSTEM_ROLE, {
        id: SYSTEM_ROLE,
        name: 'admin',
        isSystem: true
      });
      roleRows.set(CUSTOM_ROLE, {
        id: CUSTOM_ROLE,
        name: 'editor',
        isSystem: false
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
    const ROLE_A = '55555555-5555-4555-8555-555555555555';
    const ROLE_B = '66666666-6666-4666-8666-666666666666';

    beforeEach(() => {
      roleRows.set(ROLE_A, { id: ROLE_A, name: 'editor-a', isSystem: false });
      roleRows.set(ROLE_B, { id: ROLE_B, name: 'editor-b', isSystem: false });
      // Allow update only on the role named 'editor-a'.
      holder.current = abilityWithRule('update', 'Role', { name: 'editor-a' });
    });

    it('returns 403 when patching a role that does not satisfy the condition', async () => {
      await request(http())
        .patch(`/roles/${ROLE_B}`)
        .send({ description: 'x' })
        .expect(403);
      expect(save).not.toHaveBeenCalled();
    });

    it('returns 200 when patching a role that satisfies the condition', async () => {
      await request(http())
        .patch(`/roles/${ROLE_A}`)
        .send({ description: 'x' })
        .expect(200);
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ id: ROLE_A, description: 'x' })
      );
    });
  });

  // RBAC resources: PATCH /rbac/resources/:id

  describe('PATCH /api/v1/rbac/resources/:id with fieldMatch on name', () => {
    const USERS_RESOURCE = '77777777-7777-4777-8777-777777777777';
    const ROLES_RESOURCE = '88888888-8888-4888-8888-888888888888';

    beforeEach(() => {
      resourceRows.set(USERS_RESOURCE, {
        id: USERS_RESOURCE,
        name: 'users',
        actionNames: ['read']
      });
      resourceRows.set(ROLES_RESOURCE, {
        id: ROLES_RESOURCE,
        name: 'roles',
        actionNames: ['read']
      });
      holder.current = abilityWithRule('update', 'Permission', {
        name: { $in: ['users'] }
      });
    });

    it('returns 403 when the resource does not satisfy the condition', async () => {
      await request(http())
        .patch(`/rbac/resources/${ROLES_RESOURCE}`)
        .send({ displayName: 'Roles' })
        .expect(403);
      expect(save).not.toHaveBeenCalled();
    });

    it('returns 200 when the resource satisfies the condition', async () => {
      await request(http())
        .patch(`/rbac/resources/${USERS_RESOURCE}`)
        .send({ displayName: 'Accounts' })
        .expect(200);
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ id: USERS_RESOURCE, displayName: 'Accounts' })
      );
    });
  });
});
