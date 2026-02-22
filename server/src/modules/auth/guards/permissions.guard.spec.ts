import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PermissionService } from '../services/permission.service';
import { CaslAbilityFactory } from '../casl/casl-ability.factory';
import { createMongoAbility } from '@casl/ability';
import type { RawRuleOf } from '@casl/ability';
import type { AppAbility, Actions, Subjects } from '../casl/app-ability';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;
  let permissionService: { getPermissionsForUser: jest.Mock };
  let caslAbilityFactory: { createForUser: jest.Mock };

  function createMockContext(user: Record<string, unknown>): ExecutionContext {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user })
      })
    } as unknown as ExecutionContext;
  }

  function buildAbilityWith(...permissionStrings: string[]): AppAbility {
    const subjectMap: Record<string, Subjects> = {
      users: 'User',
      roles: 'Role',
      permissions: 'Permission',
      profile: 'Profile'
    };
    const rules: RawRuleOf<AppAbility>[] = permissionStrings.map((p) => {
      const [resource, action] = p.split(':');
      return {
        action: action as Actions,
        subject: subjectMap[resource] ?? (resource as Subjects)
      };
    });
    return createMongoAbility<AppAbility>(rules);
  }

  beforeEach(() => {
    reflector = new Reflector();
    permissionService = {
      getPermissionsForUser: jest.fn()
    };
    caslAbilityFactory = {
      createForUser: jest.fn()
    };

    guard = new PermissionsGuard(
      reflector,
      permissionService as unknown as PermissionService,
      caslAbilityFactory as unknown as CaslAbilityFactory
    );
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should pass when no permissions are required', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockContext({
      userId: 'user-1',
      roles: ['user']
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should pass when user has admin role', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([['delete', 'User']]);
    const context = createMockContext({
      userId: 'user-1',
      roles: ['admin']
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(permissionService.getPermissionsForUser).not.toHaveBeenCalled();
    expect(caslAbilityFactory.createForUser).not.toHaveBeenCalled();
  });

  it('should pass when user has all required permissions', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([['read', 'User']]);
    permissionService.getPermissionsForUser.mockResolvedValue([
      {
        permission: 'users:read',
        resource: 'users',
        action: 'read',
        conditions: null
      }
    ]);
    caslAbilityFactory.createForUser.mockReturnValue(
      buildAbilityWith('users:read')
    );
    const context = createMockContext({
      userId: 'user-1',
      roles: ['user']
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should throw ForbiddenException when user lacks permissions', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([['delete', 'User']]);
    permissionService.getPermissionsForUser.mockResolvedValue([
      {
        permission: 'users:read',
        resource: 'users',
        action: 'read',
        conditions: null
      }
    ]);
    caslAbilityFactory.createForUser.mockReturnValue(
      buildAbilityWith('users:read')
    );
    const context = createMockContext({
      userId: 'user-1',
      roles: ['user']
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException
    );
  });

  it('should require ALL permissions when multiple are specified', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      ['read', 'User'],
      ['update', 'User']
    ]);
    permissionService.getPermissionsForUser.mockResolvedValue([
      {
        permission: 'users:read',
        resource: 'users',
        action: 'read',
        conditions: null
      }
    ]);
    caslAbilityFactory.createForUser.mockReturnValue(
      buildAbilityWith('users:read')
    );
    const context = createMockContext({
      userId: 'user-1',
      roles: ['user']
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException
    );
  });
});
