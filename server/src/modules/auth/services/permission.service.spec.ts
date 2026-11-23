import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { PermissionService } from './permission.service';
import { User } from '../../users/entities/user.entity';
import { MetricsService } from '../../core/metrics/metrics.service';
import { attachRoles } from '../../users/utils/user-roles';

jest.mock('../../users/utils/user-roles', () =>
  jest
    .requireActual<{
      userRolesDouble: () => object;
    }>('../../users/testing/user-roles.double')
    .userRolesDouble()
);

describe('PermissionService', () => {
  let service: PermissionService;
  let mockUserRepository: {
    findOne: jest.Mock;
    manager: { findOne: (entity: unknown, options: unknown) => unknown };
  };
  let mockCacheManager: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };
  let mockMetrics: { recordCacheAccess: jest.Mock };

  const mockResource = { id: 'res-1', name: 'users', subject: 'User' };
  const mockAction = { id: 'act-1', name: 'read', displayName: 'Read' };

  const mockPermission = {
    id: 'perm-1',
    resourceId: 'res-1',
    actionId: 'act-1',
    resource: mockResource,
    action: mockAction
  };

  const mockRolePermission = {
    id: 'rp-1',
    conditions: null,
    permission: mockPermission
  };

  const mockRole = {
    id: 'role-1',
    name: 'admin',
    isSuper: true,
    rolePermissions: [mockRolePermission]
  };

  const mockUser = {
    id: 'user-1',
    roles: [mockRole]
  };

  beforeEach(async () => {
    const findOne = jest.fn();

    mockUserRepository = {
      findOne,
      manager: {
        findOne: (_entity: unknown, options: unknown): unknown =>
          findOne(options)
      }
    };

    mockCacheManager = {
      get: jest.fn((key: string) =>
        Promise.resolve(key === 'permissions:user-version:user-1' ? 7 : null)
      ),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined)
    };

    mockMetrics = { recordCacheAccess: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager
        },
        {
          provide: MetricsService,
          useValue: mockMetrics
        }
      ]
    }).compile();

    service = module.get<PermissionService>(PermissionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPermissionsForUser', () => {
    // Regression: an absent id is dropped from the WHERE clause, so the lookup
    // used to resolve to an arbitrary user's permissions instead of none
    it('should return no permissions for an empty user id without querying', async () => {
      const result = await service.getPermissionsForUser('');

      expect(result).toEqual([]);
      expect(mockUserRepository.findOne).not.toHaveBeenCalled();
    });

    it('should return cached permissions if available', async () => {
      const cachedPermissions = [
        {
          resource: 'users',
          action: 'read',
          permission: 'users:read',
          conditions: null
        }
      ];

      mockCacheManager.get.mockResolvedValue(cachedPermissions);

      const result = await service.getPermissionsForUser('user-1');

      expect(result).toEqual(cachedPermissions);
      expect(mockUserRepository.findOne).not.toHaveBeenCalled();
      expect(mockMetrics.recordCacheAccess).toHaveBeenCalledWith(
        'permissions',
        'hit'
      );
    });

    it('should query and cache permissions when not cached', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.getPermissionsForUser('user-1');

      expect(result).toEqual([
        {
          resource: 'users',
          action: 'read',
          permission: 'users:read',
          conditions: null
        }
      ]);
      expect(attachRoles).toHaveBeenCalledWith(
        mockUserRepository.manager,
        [mockUser],
        { rolePermissions: { permission: { resource: true, action: true } } }
      );
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'permissions:v2:user-1:v7',
        result,
        120_000
      );
      expect(mockMetrics.recordCacheAccess).toHaveBeenCalledWith(
        'permissions',
        'miss'
      );
    });

    it('should return empty array if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      const result = await service.getPermissionsForUser('nonexistent');

      expect(result).toEqual([]);
    });

    it('should deduplicate permissions from multiple roles', async () => {
      const userWithMultipleRoles = {
        id: 'user-1',
        roles: [
          {
            id: 'role-1',
            name: 'admin',
            isSuper: true,
            rolePermissions: [mockRolePermission]
          },
          {
            id: 'role-2',
            name: 'editor',
            isSuper: false,
            rolePermissions: [
              { ...mockRolePermission, id: 'rp-2' } // same permission
            ]
          }
        ]
      };

      mockUserRepository.findOne.mockResolvedValue(userWithMultipleRoles);

      const result = await service.getPermissionsForUser('user-1');

      expect(result).toHaveLength(1);
    });

    it('should keep allow and deny for the same resource+action as separate rules', async () => {
      const allowRp = {
        ...mockRolePermission,
        id: 'rp-allow',
        conditions: null
      };
      const denyRp = {
        ...mockRolePermission,
        id: 'rp-deny',
        conditions: { effect: 'deny', fieldMatch: { status: ['locked'] } }
      };
      const userWithAllowAndDeny = {
        id: 'user-1',
        roles: [
          {
            id: 'role-allow',
            name: 'editor',
            isSuper: false,
            rolePermissions: [allowRp]
          },
          {
            id: 'role-deny',
            name: 'limiter',
            isSuper: false,
            rolePermissions: [denyRp]
          }
        ]
      };

      mockUserRepository.findOne.mockResolvedValue(userWithAllowAndDeny);

      const result = await service.getPermissionsForUser('user-1');

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        resource: 'users',
        action: 'read',
        permission: 'users:read',
        conditions: null
      });
      expect(result).toContainEqual({
        resource: 'users',
        action: 'read',
        permission: 'users:read',
        conditions: { effect: 'deny', fieldMatch: { status: ['locked'] } }
      });
    });

    // Regression: the key ignored conditions, so the second restriction role
    // on one permission was silently dropped and its deny never applied.
    it('should keep two deny rules with different conditions from two roles', async () => {
      const denyA = {
        effect: 'deny',
        custom: '{"email":"a@victim.test"}'
      };
      const denyB = {
        effect: 'deny',
        custom: '{"email":"b@victim.test"}'
      };

      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        roles: [
          {
            id: 'role-deny-a',
            name: 'limiter-a',
            isSuper: false,
            rolePermissions: [
              { ...mockRolePermission, id: 'rp-a', conditions: denyA }
            ]
          },
          {
            id: 'role-deny-b',
            name: 'limiter-b',
            isSuper: false,
            rolePermissions: [
              { ...mockRolePermission, id: 'rp-b', conditions: denyB }
            ]
          }
        ]
      });

      const result = await service.getPermissionsForUser('user-1');

      expect(result.map((p) => p.conditions)).toEqual([denyA, denyB]);
    });

    it('should deduplicate rows whose conditions are equal', async () => {
      const deny = { effect: 'deny', fieldMatch: { status: ['locked'] } };

      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        roles: [
          {
            id: 'role-1',
            name: 'limiter-a',
            isSuper: false,
            rolePermissions: [
              { ...mockRolePermission, id: 'rp-1', conditions: deny }
            ]
          },
          {
            id: 'role-2',
            name: 'limiter-b',
            isSuper: false,
            rolePermissions: [
              { ...mockRolePermission, id: 'rp-2', conditions: { ...deny } }
            ]
          }
        ]
      });

      const result = await service.getPermissionsForUser('user-1');

      expect(result).toEqual([
        {
          resource: 'users',
          action: 'read',
          permission: 'users:read',
          conditions: deny
        }
      ]);
    });

    it('drops a grant of the user role outside its ceiling and keeps the rest', async () => {
      const rp = (
        id: string,
        action: string,
        conditions: Record<string, unknown> | null
      ) => ({
        id,
        conditions,
        permission: {
          ...mockPermission,
          action: { ...mockAction, name: action }
        }
      });
      const ownership = { ownership: { userField: 'id' } };
      const deny = { effect: 'deny', fieldMatch: { isActive: [false] } };

      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        roles: [
          {
            id: 'role-user',
            name: 'user',
            isSuper: false,
            rolePermissions: [
              rp('rp-own', 'update', ownership),
              rp('rp-any', 'update', null),
              rp('rp-search', 'search', null),
              rp('rp-deny', 'delete', deny)
            ]
          },
          {
            id: 'role-reader',
            name: 'reader',
            isSuper: false,
            rolePermissions: [rp('rp-reader', 'search', null)]
          }
        ]
      });
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const result = await service.getPermissionsForUser('user-1');

      expect(
        result.map(({ action, conditions }) => [action, conditions])
      ).toEqual([
        ['update', ownership],
        ['delete', deny],
        ['search', null]
      ]);
      expect(warn).toHaveBeenCalledTimes(2);

      await service.getPermissionsForUser('user-1');

      expect(warn).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    });
  });

  describe('getRolesForUser', () => {
    // Regression: without this guard an absent id resolved to the first user in
    // the table - on a fresh deployment, the seeded admin
    it('should return no roles for an empty user id without querying', async () => {
      const result = await service.getRolesForUser('');

      expect(result).toEqual([]);
      expect(mockUserRepository.findOne).not.toHaveBeenCalled();
    });

    it('should return cached roles if available', async () => {
      const cachedRoles = [{ name: 'admin', isSuper: true }];

      mockCacheManager.get.mockResolvedValue(cachedRoles);

      const result = await service.getRolesForUser('user-1');

      expect(result).toEqual(cachedRoles);
      expect(mockUserRepository.findOne).not.toHaveBeenCalled();
      expect(mockMetrics.recordCacheAccess).toHaveBeenCalledWith(
        'roles',
        'hit'
      );
    });

    it('should query and cache roles when not cached', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        roles: [
          { name: 'admin', isSuper: true },
          { name: 'user', isSuper: false }
        ]
      });

      const result = await service.getRolesForUser('user-1');

      expect(result).toEqual([
        { name: 'admin', isSuper: true },
        { name: 'user', isSuper: false }
      ]);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'roles:user-1:v7',
        result,
        120_000
      );
      expect(mockMetrics.recordCacheAccess).toHaveBeenCalledWith(
        'roles',
        'miss'
      );
    });

    it('should return empty array if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      const result = await service.getRolesForUser('nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('getRoleNamesForUser', () => {
    it('should return role name strings', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        roles: [
          { name: 'admin', isSuper: true },
          { name: 'user', isSuper: false }
        ]
      });

      const result = await service.getRoleNamesForUser('user-1');

      expect(result).toEqual(['admin', 'user']);
    });
  });

  describe('invalidateUserCache', () => {
    it('bumps the version of the user instead of deleting the entries', async () => {
      await service.invalidateUserCache('user-1');

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'permissions:user-version:user-1',
        expect.any(Number),
        0
      );
      const [, version] = mockCacheManager.set.mock.calls[0] as [
        string,
        number,
        number
      ];

      expect(version).toBeGreaterThan(7);
      expect(mockCacheManager.del).not.toHaveBeenCalled();
    });
  });
});
