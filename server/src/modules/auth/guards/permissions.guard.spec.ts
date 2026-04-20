import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { createMongoAbility } from '@casl/ability';
import type { RawRuleOf } from '@casl/ability';
import type { AppAbility, Subjects } from '../casl/app-ability';
import type { AuditService } from '../../audit/audit.service';
import type { MetricsService } from '../../core/metrics/metrics.service';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;
  let permissionService: {
    getPermissionsForUser: jest.Mock;
    getRolesForUser: jest.Mock;
  };
  let caslAbilityFactory: { createForUser: jest.Mock };
  let auditService: Pick<AuditService, 'logFireAndForget'>;
  let metricsService: Pick<MetricsService, 'recordPermissionDenied'>;

  function createMockContext(user: Record<string, unknown>): {
    context: ExecutionContext;
    req: Record<string, unknown>;
  } {
    const req = { user, ip: '127.0.0.1' };
    const context: ExecutionContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        // @ts-expect-error testing mock
        getRequest: () => req
      })
    };
    return { context, req };
  }

  function buildAbilityWith(...permissionStrings: string[]): AppAbility {
    const subjectMap: Record<string, string> = {
      users: 'User',
      roles: 'Role',
      permissions: 'Permission',
      profile: 'Profile'
    };
    const rules: RawRuleOf<AppAbility>[] = permissionStrings.map((p) => {
      const [resource, action] = p.split(':');
      return {
        action: action,
        subject: (subjectMap[resource] ?? resource) as Extract<Subjects, string>
      };
    });
    return createMongoAbility<AppAbility>(rules);
  }

  function buildManageAllAbility(): AppAbility {
    return createMongoAbility<AppAbility>([
      { action: 'manage', subject: 'all' }
    ]);
  }

  beforeEach(() => {
    reflector = new Reflector();
    permissionService = {
      getPermissionsForUser: jest.fn(),
      getRolesForUser: jest.fn()
    };
    caslAbilityFactory = {
      createForUser: jest.fn()
    };
    auditService = { logFireAndForget: jest.fn() };
    metricsService = { recordPermissionDenied: jest.fn() };

    guard = new PermissionsGuard(
      reflector,
      // @ts-expect-error testing mock
      permissionService,
      caslAbilityFactory,
      auditService as AuditService,
      metricsService as MetricsService
    );
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should pass when no permissions are required', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const { context } = createMockContext({
      userId: 'user-1',
      roles: ['user']
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should pass when user has super role (via CASL manage all)', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([['delete', 'User']]);
    permissionService.getRolesForUser.mockResolvedValue([
      { name: 'admin', isSuper: true }
    ]);
    permissionService.getPermissionsForUser.mockResolvedValue([]);
    caslAbilityFactory.createForUser.mockResolvedValue(buildManageAllAbility());
    const { context } = createMockContext({
      userId: 'user-1'
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(caslAbilityFactory.createForUser).toHaveBeenCalledWith(
      'user-1',
      [{ name: 'admin', isSuper: true }],
      []
    );
  });

  it('should pass when user has all required permissions', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([['read', 'User']]);
    permissionService.getRolesForUser.mockResolvedValue([
      { name: 'user', isSuper: false }
    ]);
    permissionService.getPermissionsForUser.mockResolvedValue([
      {
        permission: 'users:read',
        resource: 'users',
        action: 'read',
        conditions: null
      }
    ]);
    caslAbilityFactory.createForUser.mockResolvedValue(
      buildAbilityWith('users:read')
    );
    const { context } = createMockContext({
      userId: 'user-1'
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should attach ability to request for downstream @CurrentAbility() usage', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([['read', 'User']]);
    permissionService.getRolesForUser.mockResolvedValue([
      { name: 'user', isSuper: false }
    ]);
    permissionService.getPermissionsForUser.mockResolvedValue([]);
    const ability = buildAbilityWith('users:read');
    caslAbilityFactory.createForUser.mockResolvedValue(ability);
    const { context, req } = createMockContext({
      userId: 'user-1'
    });

    await guard.canActivate(context);
    expect(req).toHaveProperty('ability', ability);
  });

  it('should throw ForbiddenException when user lacks permissions', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([['delete', 'User']]);
    permissionService.getRolesForUser.mockResolvedValue([
      { name: 'user', isSuper: false }
    ]);
    permissionService.getPermissionsForUser.mockResolvedValue([
      {
        permission: 'users:read',
        resource: 'users',
        action: 'read',
        conditions: null
      }
    ]);
    caslAbilityFactory.createForUser.mockResolvedValue(
      buildAbilityWith('users:read')
    );
    const { context } = createMockContext({
      userId: 'user-1'
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException
    );
    expect(auditService.logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'user-1' })
    );
    expect(metricsService.recordPermissionDenied).toHaveBeenCalledWith(
      'guard',
      'delete',
      'User'
    );
  });

  it('should require ALL permissions when multiple are specified', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      ['read', 'User'],
      ['update', 'User']
    ]);
    permissionService.getRolesForUser.mockResolvedValue([
      { name: 'user', isSuper: false }
    ]);
    permissionService.getPermissionsForUser.mockResolvedValue([
      {
        permission: 'users:read',
        resource: 'users',
        action: 'read',
        conditions: null
      }
    ]);
    caslAbilityFactory.createForUser.mockResolvedValue(
      buildAbilityWith('users:read')
    );
    const { context } = createMockContext({
      userId: 'user-1'
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException
    );
  });
});
