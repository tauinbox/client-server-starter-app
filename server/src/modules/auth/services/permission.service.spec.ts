import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { PermissionService } from './permission.service';
import { User } from '../../users/entities/user.entity';

describe('PermissionService', () => {
  let service: PermissionService;
  let mockUserRepository: { findOne: jest.Mock };
  let mockCacheManager: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };

  const mockPermission = {
    id: 'perm-1',
    resource: 'users',
    action: 'read'
  };

  const mockRolePermission = {
    id: 'rp-1',
    conditions: null,
    permission: mockPermission
  };

  const mockRole = {
    id: 'role-1',
    name: 'admin',
    rolePermissions: [mockRolePermission]
  };

  const mockUser = {
    id: 'user-1',
    roles: [mockRole]
  };

  beforeEach(async () => {
    mockUserRepository = {
      findOne: jest.fn()
    };

    mockCacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined)
    };

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
        }
      ]
    }).compile();

    service = module.get<PermissionService>(PermissionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPermissionsForUser', () => {
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
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'permissions:user-1',
        result,
        300_000
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
            rolePermissions: [mockRolePermission]
          },
          {
            id: 'role-2',
            name: 'editor',
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
  });

  describe('getRoleNamesForUser', () => {
    it('should return role names', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        roles: [{ name: 'admin' }, { name: 'user' }]
      });

      const result = await service.getRoleNamesForUser('user-1');

      expect(result).toEqual(['admin', 'user']);
    });

    it('should return empty array if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      const result = await service.getRoleNamesForUser('nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('invalidateUserPermissions', () => {
    it('should delete cache entry', async () => {
      await service.invalidateUserPermissions('user-1');

      expect(mockCacheManager.del).toHaveBeenCalledWith('permissions:user-1');
    });
  });

  describe('hasPermission', () => {
    it('should return true if user has the permission', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.hasPermission('user-1', 'users:read');

      expect(result).toBe(true);
    });

    it('should return false if user lacks the permission', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.hasPermission('user-1', 'users:delete');

      expect(result).toBe(false);
    });
  });
});
