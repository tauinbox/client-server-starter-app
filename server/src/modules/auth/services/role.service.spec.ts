import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, HttpException } from '@nestjs/common';
import { RoleService } from './role.service';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { PermissionService } from './permission.service';
import type { AppAbility } from '../casl/app-ability';
import { User } from '../../users/entities/user.entity';
import { AuditService } from '../../audit/audit.service';

describe('RoleService', () => {
  let service: RoleService;
  let mockRoleRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    manager: {
      createQueryBuilder: jest.Mock;
      update: jest.Mock;
      findOne: jest.Mock;
    };
    createQueryBuilder: jest.Mock;
  };
  let mockPermissionRepo: { find: jest.Mock };
  let mockRolePermissionRepo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let mockRoleRepoQB: {
    innerJoin: jest.Mock;
    where: jest.Mock;
    getMany: jest.Mock;
  };
  let mockPermissionService: { invalidateUserCache: jest.Mock };
  let mockRelationQueryBuilder: {
    relation: jest.Mock;
    of: jest.Mock;
    add: jest.Mock;
    remove: jest.Mock;
  };
  let mockUserQueryBuilder: {
    select: jest.Mock;
    innerJoin: jest.Mock;
    getMany: jest.Mock;
  };

  const systemRole: Role = {
    id: 'role-1',
    name: 'admin',
    description: 'Admin role',
    isSystem: true,
    isSuper: true,
    rolePermissions: [],
    users: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const customRole: Role = {
    id: 'role-2',
    name: 'editor',
    description: 'Editor role',
    isSystem: false,
    isSuper: false,
    rolePermissions: [],
    users: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  beforeEach(async () => {
    mockRoleRepoQB = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([])
    };

    mockRelationQueryBuilder = {
      relation: jest.fn().mockReturnThis(),
      of: jest.fn().mockReturnThis(),
      add: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined)
    };

    mockUserQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([])
    };

    mockRoleRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) => data),
      save: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) =>
          Promise.resolve({ id: 'new-role', ...data })
        ),
      remove: jest.fn(),
      manager: {
        createQueryBuilder: jest
          .fn()
          .mockImplementation((...args: unknown[]) =>
            args.length > 0 ? mockUserQueryBuilder : mockRelationQueryBuilder
          ),
        update: jest.fn().mockResolvedValue(undefined),
        findOne: jest.fn().mockResolvedValue(null)
      },
      createQueryBuilder: jest.fn().mockReturnValue(mockRoleRepoQB)
    };

    mockPermissionRepo = {
      find: jest.fn()
    };

    mockRolePermissionRepo = {
      find: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) => data),
      save: jest.fn(),
      delete: jest.fn(),
      manager: {
        transaction: jest
          .fn()
          .mockImplementation(
            async (
              cb: (em: {
                delete: jest.Mock;
                create: jest.Mock;
                save: jest.Mock;
              }) => Promise<void>
            ) => {
              const em = {
                delete: jest.fn().mockResolvedValue(undefined),
                create: jest
                  .fn()
                  .mockImplementation(
                    (_, data: Record<string, unknown>) => data
                  ),
                save: jest.fn().mockResolvedValue(undefined)
              };
              await cb(em);
            }
          )
      }
    };

    mockPermissionService = {
      invalidateUserCache: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleService,
        { provide: getRepositoryToken(Role), useValue: mockRoleRepo },
        {
          provide: getRepositoryToken(Permission),
          useValue: mockPermissionRepo
        },
        {
          provide: getRepositoryToken(RolePermission),
          useValue: mockRolePermissionRepo
        },
        { provide: PermissionService, useValue: mockPermissionService },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn(),
            logFireAndForget: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get<RoleService>(RoleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all roles', async () => {
      mockRoleRepo.find.mockResolvedValue([systemRole, customRole]);
      const result = await service.findAll();
      expect(result).toHaveLength(2);
    });
  });

  describe('findOne', () => {
    it('should return a role by id', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);
      const result = await service.findOne('role-1');
      expect(result.name).toBe('admin');
    });

    it('should throw HttpException if not found', async () => {
      mockRoleRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('bad-id')).rejects.toThrow(HttpException);
    });
  });

  describe('create', () => {
    it('should create a new role', async () => {
      mockRoleRepo.findOne.mockResolvedValue(null);
      const result = await service.create({
        name: 'viewer',
        description: 'View only'
      });
      expect(result.name).toBe('viewer');
    });

    it('should throw if name already exists', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      await expect(service.create({ name: 'editor' })).rejects.toThrow(
        HttpException
      );
    });

    it('should throw HttpException if isSuper is provided', async () => {
      await expect(
        service.create({ name: 'superrole', isSuper: true })
      ).rejects.toThrow(HttpException);
      expect(mockRoleRepo.findOne).not.toHaveBeenCalled();
    });

    it('should always create role with isSuper false regardless of input', async () => {
      mockRoleRepo.findOne.mockResolvedValue(null);
      await service.create({ name: 'viewer' });
      expect(mockRoleRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ isSuper: false })
      );
    });
  });

  describe('update', () => {
    it('should throw if role is system', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);
      await expect(
        service.update('role-1', { name: 'superadmin' })
      ).rejects.toThrow(HttpException);
    });

    it('should update a custom role', async () => {
      mockRoleRepo.findOne.mockResolvedValueOnce(customRole);
      mockRoleRepo.findOne.mockResolvedValueOnce(null); // no name conflict
      mockRoleRepo.save.mockResolvedValue({
        ...customRole,
        description: 'Updated'
      });

      const result = await service.update('role-2', {
        description: 'Updated'
      });
      expect(result.description).toBe('Updated');
    });
  });

  describe('delete', () => {
    it('should throw if role is system', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);
      await expect(service.delete('role-1')).rejects.toThrow(HttpException);
    });

    it('should delete a custom role and invalidate cache for its members', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockUserQueryBuilder.getMany.mockResolvedValue([
        { id: 'u-1' },
        { id: 'u-2' }
      ]);
      await service.delete('role-2');
      expect(mockPermissionService.invalidateUserCache).toHaveBeenCalledWith(
        'u-1'
      );
      expect(mockPermissionService.invalidateUserCache).toHaveBeenCalledWith(
        'u-2'
      );
      expect(mockRoleRepo.remove).toHaveBeenCalledWith(customRole);
    });

    it('should delete a custom role with no members without calling invalidate', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      await service.delete('role-2');
      expect(mockPermissionService.invalidateUserCache).not.toHaveBeenCalled();
      expect(mockRoleRepo.remove).toHaveBeenCalledWith(customRole);
    });
  });

  describe('assignPermissionsToRole', () => {
    it('should save permissions and invalidate cache for all role members', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockRolePermissionRepo.save.mockResolvedValue([]);
      mockUserQueryBuilder.getMany.mockResolvedValue([
        { id: 'u-1' },
        { id: 'u-2' }
      ]);

      await service.assignPermissionsToRole('role-2', ['perm-1', 'perm-2']);

      expect(mockRolePermissionRepo.save).toHaveBeenCalled();
      expect(mockPermissionService.invalidateUserCache).toHaveBeenCalledWith(
        'u-1'
      );
      expect(mockPermissionService.invalidateUserCache).toHaveBeenCalledWith(
        'u-2'
      );
    });

    it('should not call invalidate if no users have the role', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockRolePermissionRepo.save.mockResolvedValue([]);

      await service.assignPermissionsToRole('role-2', ['perm-1']);

      expect(mockPermissionService.invalidateUserCache).not.toHaveBeenCalled();
    });
  });

  describe('removePermissionFromRole', () => {
    it('should remove permission and invalidate cache for all role members', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockRolePermissionRepo.delete.mockResolvedValue({ affected: 1 });
      mockUserQueryBuilder.getMany.mockResolvedValue([{ id: 'u-1' }]);

      await service.removePermissionFromRole('role-2', 'perm-1');

      expect(mockRolePermissionRepo.delete).toHaveBeenCalledWith({
        roleId: 'role-2',
        permissionId: 'perm-1'
      });
      expect(mockPermissionService.invalidateUserCache).toHaveBeenCalledWith(
        'u-1'
      );
    });

    it('should not call invalidate if no users have the role', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockRolePermissionRepo.delete.mockResolvedValue({ affected: 1 });

      await service.removePermissionFromRole('role-2', 'perm-1');

      expect(mockPermissionService.invalidateUserCache).not.toHaveBeenCalled();
    });
  });

  describe('assignRoleToUser', () => {
    it('should assign role and invalidate cache', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      await service.assignRoleToUser('user-1', 'role-2');

      expect(mockRelationQueryBuilder.add).toHaveBeenCalledWith('role-2');
      expect(mockPermissionService.invalidateUserCache).toHaveBeenCalledWith(
        'user-1'
      );
    });

    it('should throw ForbiddenException when assigning a super role with ability', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: jest.fn().mockReturnValue(true) };

      await expect(
        service.assignRoleToUser('user-1', 'role-1', ability)
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when ability denies update on target user', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      const targetUser = { id: 'user-99' } as User;
      mockRoleRepo.manager.findOne.mockResolvedValue(targetUser);
      const canSpy = jest.fn().mockReturnValue(false);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: canSpy };

      await expect(
        service.assignRoleToUser('user-99', 'role-2', ability)
      ).rejects.toThrow(ForbiddenException);
      expect(canSpy).toHaveBeenCalledWith('update', targetUser);
    });

    it('should proceed when ability allows update on target user', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      const targetUser = { id: 'user-1' } as User;
      mockRoleRepo.manager.findOne.mockResolvedValue(targetUser);
      mockRolePermissionRepo.find.mockResolvedValue([]);
      const canSpy = jest.fn().mockReturnValue(true);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: canSpy };

      await service.assignRoleToUser('user-1', 'role-2', ability);

      expect(canSpy).toHaveBeenCalledWith('update', targetUser);
      expect(mockRelationQueryBuilder.add).toHaveBeenCalledWith('role-2');
    });
  });

  describe('removeRoleFromUser', () => {
    it('should remove role and invalidate cache', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);

      await service.removeRoleFromUser('user-1', 'role-2');

      expect(mockRelationQueryBuilder.remove).toHaveBeenCalledWith('role-2');
      expect(mockPermissionService.invalidateUserCache).toHaveBeenCalledWith(
        'user-1'
      );
      expect(mockRoleRepo.manager.update).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when removing a super role with ability', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: jest.fn().mockReturnValue(true) };

      await expect(
        service.removeRoleFromUser('user-1', 'role-1', ability)
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when ability denies update on target user', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      const targetUser = { id: 'user-99' } as User;
      mockRoleRepo.manager.findOne.mockResolvedValue(targetUser);
      const canSpy = jest.fn().mockReturnValue(false);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: canSpy };

      await expect(
        service.removeRoleFromUser('user-99', 'role-2', ability)
      ).rejects.toThrow(ForbiddenException);
      expect(canSpy).toHaveBeenCalledWith('update', targetUser);
    });

    it('should proceed when ability allows update on target user', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      const targetUser = { id: 'user-1' } as User;
      mockRoleRepo.manager.findOne.mockResolvedValue(targetUser);
      const canSpy = jest.fn().mockReturnValue(true);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: canSpy };

      await service.removeRoleFromUser('user-1', 'role-2', ability);

      expect(canSpy).toHaveBeenCalledWith('update', targetUser);
      expect(mockRelationQueryBuilder.remove).toHaveBeenCalledWith('role-2');
    });

    it('should revoke tokens when removing a super role (no ability)', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);

      await service.removeRoleFromUser('user-1', 'role-1');

      expect(mockRelationQueryBuilder.remove).toHaveBeenCalledWith('role-1');
      expect(mockRoleRepo.manager.update).toHaveBeenCalledWith(
        expect.anything(),
        'user-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ tokenRevokedAt: expect.any(Date) })
      );
      expect(mockPermissionService.invalidateUserCache).toHaveBeenCalledWith(
        'user-1'
      );
    });
  });

  describe('findAllPermissions', () => {
    it('should return all permissions', async () => {
      const permissions = [{ id: 'p1', resource: 'users', action: 'read' }];
      mockPermissionRepo.find.mockResolvedValue(permissions);
      const result = await service.findAllPermissions();
      expect(result).toEqual(permissions);
    });
  });

  describe('update — additional branches', () => {
    it('should throw HttpException if isSuper is in update payload', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      await expect(service.update('role-2', { isSuper: true })).rejects.toThrow(
        HttpException
      );
    });

    it('should throw HttpException when updating name to an existing name', async () => {
      const conflictRole: Role = {
        ...customRole,
        id: 'role-99',
        name: 'viewer'
      };
      mockRoleRepo.findOne
        .mockResolvedValueOnce(customRole) // findOne(id) call
        .mockResolvedValueOnce(conflictRole); // findOne({ name }) conflict check
      await expect(
        service.update('role-2', { name: 'viewer' })
      ).rejects.toThrow(HttpException);
    });

    it('should allow renaming to the same name (no conflict)', async () => {
      mockRoleRepo.findOne
        .mockResolvedValueOnce(customRole) // findOne(id)
        .mockResolvedValueOnce(customRole); // same id → no conflict
      mockRoleRepo.save.mockResolvedValue({ ...customRole, name: 'editor' });
      const result = await service.update('role-2', { name: 'editor' });
      expect(result.name).toBe('editor');
    });
  });

  describe('findRolesForUser', () => {
    it('should query roles for a user via createQueryBuilder', async () => {
      const roles = [systemRole];
      mockRoleRepoQB.getMany.mockResolvedValue(roles);

      const result = await service.findRolesForUser('user-1');

      expect(mockRoleRepo.createQueryBuilder).toHaveBeenCalledWith('role');
      expect(mockRoleRepoQB.innerJoin).toHaveBeenCalledWith(
        'user_roles',
        'ur',
        'ur.role_id = role.id'
      );
      expect(mockRoleRepoQB.where).toHaveBeenCalledWith(
        'ur.user_id = :userId',
        { userId: 'user-1' }
      );
      expect(result).toEqual(roles);
    });
  });

  describe('getPermissionsForRole', () => {
    it('should return permissions for a role', async () => {
      const perms = [{ id: 'rp-1', roleId: 'role-2', permissionId: 'perm-1' }];
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockRolePermissionRepo.find.mockResolvedValue(perms);

      const result = await service.getPermissionsForRole('role-2');

      expect(mockRolePermissionRepo.find).toHaveBeenCalledWith({
        where: { roleId: 'role-2' },
        relations: ['permission']
      });
      expect(result).toEqual(perms);
    });

    it('should throw HttpException when role does not exist', async () => {
      mockRoleRepo.findOne.mockResolvedValue(null);
      await expect(service.getPermissionsForRole('bad-id')).rejects.toThrow(
        HttpException
      );
    });
  });

  describe('setPermissionsForRole', () => {
    it('should delete existing and save new permissions inside a transaction', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockUserQueryBuilder.getMany.mockResolvedValue([]);
      const items = [{ permissionId: 'perm-1' }, { permissionId: 'perm-2' }];

      await service.setPermissionsForRole('role-2', items);

      expect(mockRolePermissionRepo.manager.transaction).toHaveBeenCalled();
    });

    it('should skip save when items array is empty', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockUserQueryBuilder.getMany.mockResolvedValue([]);

      await service.setPermissionsForRole('role-2', []);

      expect(mockRolePermissionRepo.manager.transaction).toHaveBeenCalled();
    });

    it('should invalidate cache for all role members after setting permissions', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockUserQueryBuilder.getMany.mockResolvedValue([{ id: 'u-1' }]);

      await service.setPermissionsForRole('role-2', [
        { permissionId: 'perm-1' }
      ]);

      expect(mockPermissionService.invalidateUserCache).toHaveBeenCalledWith(
        'u-1'
      );
    });
  });

  describe('findRoleByName', () => {
    it('should return role when found by name', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);
      const result = await service.findRoleByName('admin');
      expect(result).toBe(systemRole);
      expect(mockRoleRepo.findOne).toHaveBeenCalledWith({
        where: { name: 'admin' }
      });
    });

    it('should throw HttpException when role not found', async () => {
      mockRoleRepo.findOne.mockResolvedValue(null);
      await expect(service.findRoleByName('nonexistent')).rejects.toThrow(
        HttpException
      );
    });
  });
});
