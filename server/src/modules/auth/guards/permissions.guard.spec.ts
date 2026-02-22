import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PermissionService } from '../services/permission.service';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;
  let permissionService: { getPermissionsForUser: jest.Mock };

  function createMockContext(user: Record<string, unknown>): ExecutionContext {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user })
      })
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = new Reflector();
    permissionService = {
      getPermissionsForUser: jest.fn()
    };

    guard = new PermissionsGuard(
      reflector,
      permissionService as unknown as PermissionService
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
      .mockReturnValue(['users:delete']);
    const context = createMockContext({
      userId: 'user-1',
      roles: ['admin']
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(permissionService.getPermissionsForUser).not.toHaveBeenCalled();
  });

  it('should pass when user has all required permissions', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['users:read']);
    permissionService.getPermissionsForUser.mockResolvedValue([
      {
        permission: 'users:read',
        resource: 'users',
        action: 'read',
        conditions: null
      }
    ]);
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
      .mockReturnValue(['users:delete']);
    permissionService.getPermissionsForUser.mockResolvedValue([
      {
        permission: 'users:read',
        resource: 'users',
        action: 'read',
        conditions: null
      }
    ]);
    const context = createMockContext({
      userId: 'user-1',
      roles: ['user']
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException
    );
  });

  it('should require ALL permissions when multiple are specified', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['users:read', 'users:update']);
    permissionService.getPermissionsForUser.mockResolvedValue([
      {
        permission: 'users:read',
        resource: 'users',
        action: 'read',
        conditions: null
      }
    ]);
    const context = createMockContext({
      userId: 'user-1',
      roles: ['user']
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException
    );
  });
});
