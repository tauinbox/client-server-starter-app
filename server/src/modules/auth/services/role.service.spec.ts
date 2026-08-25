import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, HttpException } from '@nestjs/common';
import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import { RoleService } from './role.service';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { PermissionService } from './permission.service';
import type { AppAbility } from '../casl/app-ability';
import { User } from '../../users/entities/user.entity';
import { AuditService } from '../../audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RolePermissionsChangedEvent } from '../events/role-permissions-changed.event';

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
  let mockAuditService: { log: jest.Mock; logFireAndForget: jest.Mock };
  let mockMetricsService: { recordPermissionDenied: jest.Mock };
  let mockEventEmitter: { emit: jest.Mock };
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
        // Role membership writes now resolve the target user first, so the
        // default is an existing row; absence is opted into per test.
        findOne: jest.fn().mockResolvedValue({ id: 'user-1' })
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

    mockAuditService = {
      log: jest.fn(),
      logFireAndForget: jest.fn()
    };

    mockMetricsService = {
      recordPermissionDenied: jest.fn()
    };

    mockEventEmitter = {
      emit: jest.fn()
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
        { provide: AuditService, useValue: mockAuditService },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: EventEmitter2, useValue: mockEventEmitter }
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

    it('should throw 404 without writing membership when the target user is unknown or soft-deleted', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockRoleRepo.manager.findOne.mockResolvedValue(null);
      const canSpy = jest.fn().mockReturnValue(false);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: canSpy };

      await expect(
        service.assignRoleToUser('user-99', 'role-2', ability)
      ).rejects.toMatchObject({
        status: 404,
        response: { errorKey: 'errors.users.notFound' }
      });

      // The lookup must stay scoped to live rows so a soft-deleted account
      // cannot be modified without being restored first.
      expect(mockRoleRepo.manager.findOne).toHaveBeenCalledWith(User, {
        where: { id: 'user-99' }
      });
      expect(mockRelationQueryBuilder.add).not.toHaveBeenCalled();
      expect(mockPermissionService.invalidateUserCache).not.toHaveBeenCalled();
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

    it('records the denying actor on the denial audit row', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockRoleRepo.manager.findOne.mockResolvedValue({ id: 'user-99' });
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: jest.fn().mockReturnValue(false) };

      await expect(
        service.removeRoleFromUser('user-99', 'role-2', ability, 'actor-1')
      ).rejects.toThrow(ForbiddenException);

      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PERMISSION_CHECK_FAILURE',
          actorId: 'actor-1',
          targetId: 'user-99',
          targetType: 'User'
        })
      );
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

    it('should throw 404 without writing membership when the target user is unknown or soft-deleted', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockRoleRepo.manager.findOne.mockResolvedValue(null);
      const canSpy = jest.fn().mockReturnValue(false);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: canSpy };

      await expect(
        service.removeRoleFromUser('user-99', 'role-2', ability)
      ).rejects.toMatchObject({
        status: 404,
        response: { errorKey: 'errors.users.notFound' }
      });

      expect(mockRoleRepo.manager.findOne).toHaveBeenCalledWith(User, {
        where: { id: 'user-99' }
      });
      expect(mockRelationQueryBuilder.remove).not.toHaveBeenCalled();
      expect(mockPermissionService.invalidateUserCache).not.toHaveBeenCalled();
    });

    it('should remove super role and invalidate cache (token revocation handled by listener)', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);

      await service.removeRoleFromUser('user-1', 'role-1');

      expect(mockRelationQueryBuilder.remove).toHaveBeenCalledWith('role-1');
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

  describe('identity-bound conditions on a create grant', () => {
    const permCreateUser = {
      id: 'perm-create-user',
      action: { name: 'create' },
      resource: { subject: 'User' }
    };
    const permUpdateUser = {
      id: 'perm-update-user',
      action: { name: 'update' },
      resource: { subject: 'User' }
    };

    // Super callers bypass the can-grant check, so the rejection must not live
    // behind it: an ownership branch on `create` is dead for everyone.
    // @ts-expect-error partial mock - only `can` is reached before the rejection
    const superAbility: AppAbility = { can: jest.fn().mockReturnValue(true) };

    it('rejects ownership on a create grant with 400 and leaves the set untouched', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockPermissionRepo.find.mockResolvedValue([permCreateUser]);

      await expect(
        service.setPermissionsForRole(
          'role-2',
          [
            {
              permissionId: 'perm-create-user',
              conditions: { ownership: { userField: 'createdBy' } }
            }
          ],
          superAbility,
          'actor-1'
        )
      ).rejects.toMatchObject({
        status: 400,
        response: { errorKey: 'errors.roles.conditionNotApplicable' }
      });

      expect(mockRolePermissionRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('rejects userAttr on a create grant with 400 without saving', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockPermissionRepo.find.mockResolvedValue([permCreateUser]);

      await expect(
        service.assignPermissionsToRole(
          'role-2',
          ['perm-create-user'],
          { userAttr: { ownerId: 'id' } },
          superAbility,
          'actor-1'
        )
      ).rejects.toMatchObject({
        status: 400,
        response: { errorKey: 'errors.roles.conditionNotApplicable' }
      });

      expect(mockRolePermissionRepo.save).not.toHaveBeenCalled();
    });

    it('accepts ownership on an update grant', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockPermissionRepo.find.mockResolvedValue([permUpdateUser]);
      mockRolePermissionRepo.save.mockResolvedValue([]);

      await service.assignPermissionsToRole(
        'role-2',
        ['perm-update-user'],
        { ownership: { userField: 'id' } },
        superAbility,
        'actor-1'
      );

      expect(mockRolePermissionRepo.save).toHaveBeenCalled();
    });

    it('does not query permissions when no item carries an identity-bound branch', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);

      await service.setPermissionsForRole('role-2', [
        {
          permissionId: 'perm-create-user',
          conditions: { fieldMatch: { locale: ['ru'] } }
        }
      ]);

      expect(mockPermissionRepo.find).not.toHaveBeenCalled();
      expect(mockRolePermissionRepo.manager.transaction).toHaveBeenCalled();
    });
  });

  // ── RBAC-SEC-1: grant-escalation block ────────────────────────────

  describe('assertCanGrantPermissions (via service)', () => {
    const permCreateRole = {
      id: 'perm-create-role',
      action: { name: 'create' },
      resource: { subject: 'Role' }
    };
    const permUpdateUser = {
      id: 'perm-update-user',
      action: { name: 'update' },
      resource: { subject: 'User' }
    };

    function abilityMock(opts: {
      manageAll?: boolean;
      canMatrix?: Record<string, boolean>;
      rulesMatrix?: Record<
        string,
        { conditions?: unknown; inverted?: boolean }[]
      >;
    }) {
      const can = jest.fn((action: string, subject: unknown) => {
        if (opts.manageAll && action === 'manage' && subject === 'all')
          return true;
        if (opts.manageAll) return true;
        if (typeof subject === 'object' && subject !== null) {
          // entity-instance check (ability.can('update', userEntity))
          return opts.canMatrix?.[`${action}:*`] ?? false;
        }
        const key = `${action}:${String(subject)}`;
        return opts.canMatrix?.[key] ?? false;
      });
      const rulesFor = jest.fn((action: string, subject: unknown) => {
        const key = `${action}:${String(subject)}`;
        return opts.rulesMatrix?.[key] ?? [];
      });
      // @ts-expect-error partial mock — only can/rulesFor are exercised
      const ability: AppAbility = { can, rulesFor };
      return { ability, can, rulesFor };
    }

    it('super (manage:all) bypasses can-grant check and writes permissions', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockRolePermissionRepo.save.mockResolvedValue([]);
      mockPermissionRepo.find.mockResolvedValue([permCreateRole]);
      const { ability } = abilityMock({ manageAll: true });

      await service.assignPermissionsToRole(
        'role-2',
        ['perm-create-role'],
        undefined,
        ability,
        'actor-1'
      );

      // Existence is still validated for super callers; only the can-grant
      // escalation check is bypassed.
      expect(mockPermissionRepo.find).toHaveBeenCalled();
      expect(mockRolePermissionRepo.save).toHaveBeenCalled();
      expect(mockAuditService.logFireAndForget).not.toHaveBeenCalled();
    });

    it('super caller granting an unknown permission id gets 400 without saving', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockPermissionRepo.find.mockResolvedValue([]);
      const { ability } = abilityMock({ manageAll: true });

      await expect(
        service.assignPermissionsToRole(
          'role-2',
          ['perm-missing'],
          undefined,
          ability,
          'actor-1'
        )
      ).rejects.toMatchObject({
        status: 400,
        response: { errorKey: 'errors.general.resourceNotFound' }
      });

      expect(mockRolePermissionRepo.save).not.toHaveBeenCalled();
    });

    it('super caller setting an unknown permission id gets 400 without touching the set', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockPermissionRepo.find.mockResolvedValue([]);
      const { ability } = abilityMock({ manageAll: true });

      await expect(
        service.setPermissionsForRole(
          'role-2',
          [{ permissionId: 'perm-missing', conditions: null }],
          ability,
          'actor-1'
        )
      ).rejects.toMatchObject({
        status: 400,
        response: { errorKey: 'errors.general.resourceNotFound' }
      });

      expect(mockRolePermissionRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('rejects with 403 CANNOT_GRANT_PERMISSION and audits when caller lacks the permission', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockPermissionRepo.find.mockResolvedValue([permCreateRole]);
      const { ability } = abilityMock({
        canMatrix: { 'update:*': true, 'create:Role': false }
      });

      await expect(
        service.assignPermissionsToRole(
          'role-2',
          ['perm-create-role'],
          undefined,
          ability,
          'actor-1'
        )
      ).rejects.toMatchObject({
        status: 403,
        response: { errorKey: 'errors.roles.cannotGrantPermission' }
      });

      expect(mockRolePermissionRepo.save).not.toHaveBeenCalled();
      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PERMISSION_GRANT_DENIED',
          actorId: 'actor-1',
          targetId: 'role-2',
          targetType: 'Role'
        })
      );
      expect(mockMetricsService.recordPermissionDenied).toHaveBeenCalledWith(
        'instance',
        'create',
        'Role'
      );
    });

    it('rejects condition escalation: caller has only conditional rule, body omits conditions', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockPermissionRepo.find.mockResolvedValue([permUpdateUser]);
      const { ability } = abilityMock({
        canMatrix: { 'update:*': true, 'update:User': true },
        rulesMatrix: {
          'update:User': [{ conditions: { id: 'caller-1' } }]
        }
      });

      await expect(
        service.assignPermissionsToRole(
          'role-2',
          ['perm-update-user'],
          undefined,
          ability,
          'actor-1'
        )
      ).rejects.toMatchObject({
        status: 403,
        response: { errorKey: 'errors.roles.cannotGrantPermission' }
      });

      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PERMISSION_GRANT_DENIED',
          details: expect.objectContaining({
            reason: 'condition-escalation'
          }) as Record<string, unknown>
        })
      );
    });

    it('rejects a condition broader than the one the caller holds', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockPermissionRepo.find.mockResolvedValue([permUpdateUser]);
      const { ability } = abilityMock({
        canMatrix: { 'update:*': true, 'update:User': true },
        rulesMatrix: {
          'update:User': [{ conditions: { id: 'actor-1' } }]
        }
      });

      await expect(
        service.assignPermissionsToRole(
          'role-2',
          ['perm-update-user'],
          { fieldMatch: { isActive: [true] } },
          ability,
          'actor-1'
        )
      ).rejects.toMatchObject({
        status: 403,
        response: { errorKey: 'errors.roles.conditionBroaderThanCaller' }
      });

      expect(mockRolePermissionRepo.save).not.toHaveBeenCalled();
      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PERMISSION_GRANT_DENIED',
          details: expect.objectContaining({
            reason: 'condition-broader-than-caller'
          }) as Record<string, unknown>
        })
      );
    });

    it('allows a grant that keeps the caller condition and adds a restriction', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockRolePermissionRepo.save.mockResolvedValue([]);
      mockPermissionRepo.find.mockResolvedValue([permUpdateUser]);
      const { ability } = abilityMock({
        canMatrix: { 'update:*': true, 'update:User': true },
        rulesMatrix: {
          'update:User': [{ conditions: { id: 'actor-1' } }]
        }
      });

      await service.assignPermissionsToRole(
        'role-2',
        ['perm-update-user'],
        {
          ownership: { userField: 'id' },
          fieldMatch: { isActive: [true] }
        },
        ability,
        'actor-1'
      );

      expect(mockRolePermissionRepo.save).toHaveBeenCalled();
    });

    it('allows grant when caller has matching unconditional rule', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockRolePermissionRepo.save.mockResolvedValue([]);
      mockPermissionRepo.find.mockResolvedValue([permCreateRole]);
      const { ability } = abilityMock({
        canMatrix: { 'update:*': true, 'create:Role': true },
        rulesMatrix: { 'create:Role': [{ conditions: undefined }] }
      });

      await service.assignPermissionsToRole(
        'role-2',
        ['perm-create-role'],
        undefined,
        ability,
        'actor-1'
      );

      expect(mockRolePermissionRepo.save).toHaveBeenCalled();
      expect(mockAuditService.logFireAndForget).not.toHaveBeenCalled();
    });

    it('setPermissionsForRole runs the same check', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockPermissionRepo.find.mockResolvedValue([permCreateRole]);
      const { ability } = abilityMock({ canMatrix: { 'update:*': true } });

      await expect(
        service.setPermissionsForRole(
          'role-2',
          [{ permissionId: 'perm-create-role', conditions: null }],
          ability,
          'actor-1'
        )
      ).rejects.toMatchObject({
        status: 403,
        response: { errorKey: 'errors.roles.cannotGrantPermission' }
      });
    });

    it('assignRoleToUser blocks indirect escalation via role permissions', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockRoleRepo.manager.findOne.mockResolvedValue({ id: 'user-1' });
      mockRolePermissionRepo.find.mockResolvedValue([
        { permissionId: 'perm-create-role', conditions: null }
      ]);
      mockPermissionRepo.find.mockResolvedValue([permCreateRole]);
      const { ability } = abilityMock({
        canMatrix: { 'update:*': true } // can update target user, but not create:Role
      });

      await expect(
        service.assignRoleToUser('user-1', 'role-2', ability, 'actor-1')
      ).rejects.toMatchObject({ status: 403 });

      expect(mockRelationQueryBuilder.add).not.toHaveBeenCalled();
      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PERMISSION_GRANT_DENIED' })
      );
    });
  });

  // ── Instance-level update:Role on permission-set mutations ────────

  describe('instance-level update:Role check', () => {
    // Real CASL ability: the route-level @Authorize check passes for any
    // `update:Role` rule, so only an instance check catches a caller whose
    // grant is scoped to a different role.
    function abilityForRoleNamed(name: string): AppAbility {
      const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
      builder.can('update', 'Role', { name });
      return builder.build();
    }

    function expectDenialRecorded(): void {
      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PERMISSION_CHECK_FAILURE',
          actorId: 'actor-1',
          targetId: 'role-2',
          targetType: 'Role'
        })
      );
      expect(mockMetricsService.recordPermissionDenied).toHaveBeenCalledWith(
        'instance',
        'update',
        'Role'
      );
    }

    beforeEach(() => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockRolePermissionRepo.save.mockResolvedValue([]);
      mockRolePermissionRepo.delete.mockResolvedValue({ affected: 1 });
    });

    it('setPermissionsForRole rejects a role outside the caller scope', async () => {
      await expect(
        service.setPermissionsForRole(
          'role-2',
          [],
          abilityForRoleNamed('viewer'),
          'actor-1'
        )
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockRolePermissionRepo.manager.transaction).not.toHaveBeenCalled();
      expectDenialRecorded();
    });

    it('setPermissionsForRole proceeds when the condition matches the role', async () => {
      await service.setPermissionsForRole(
        'role-2',
        [],
        abilityForRoleNamed('editor'),
        'actor-1'
      );

      expect(mockRolePermissionRepo.manager.transaction).toHaveBeenCalled();
      expect(mockAuditService.logFireAndForget).not.toHaveBeenCalled();
    });

    it('assignPermissionsToRole rejects a role outside the caller scope', async () => {
      await expect(
        service.assignPermissionsToRole(
          'role-2',
          [],
          undefined,
          abilityForRoleNamed('viewer'),
          'actor-1'
        )
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockRolePermissionRepo.save).not.toHaveBeenCalled();
      expectDenialRecorded();
    });

    it('assignPermissionsToRole proceeds when the condition matches the role', async () => {
      await service.assignPermissionsToRole(
        'role-2',
        [],
        undefined,
        abilityForRoleNamed('editor'),
        'actor-1'
      );

      expect(mockRolePermissionRepo.save).toHaveBeenCalled();
      expect(mockAuditService.logFireAndForget).not.toHaveBeenCalled();
    });

    it('removePermissionFromRole rejects a role outside the caller scope', async () => {
      await expect(
        service.removePermissionFromRole(
          'role-2',
          'perm-1',
          abilityForRoleNamed('viewer'),
          'actor-1'
        )
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockRolePermissionRepo.delete).not.toHaveBeenCalled();
      expectDenialRecorded();
    });

    it('removePermissionFromRole proceeds when the condition matches the role', async () => {
      await service.removePermissionFromRole(
        'role-2',
        'perm-1',
        abilityForRoleNamed('editor'),
        'actor-1'
      );

      expect(mockRolePermissionRepo.delete).toHaveBeenCalledWith({
        roleId: 'role-2',
        permissionId: 'perm-1'
      });
      expect(mockAuditService.logFireAndForget).not.toHaveBeenCalled();
    });
  });

  // ── RBAC-SEC-3: system-role lock on permission mutations ──────────

  describe('isSystem permission-mutation guard', () => {
    // Allows the instance-level update:Role check (subject instance) while
    // failing `manage:all` (plain string subject), so these cases exercise the
    // system-role guard rather than the ABAC re-check that now precedes it.
    function nonSuperAbility(): AppAbility {
      const can = jest.fn(
        (_action: string, subj: unknown) => typeof subj === 'object'
      );
      // @ts-expect-error partial mock — only `can` is exercised
      const ability: AppAbility = { can };
      return ability;
    }

    it('setPermissionsForRole rejects on system role for non-super caller', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);
      const ability = nonSuperAbility();

      await expect(
        service.setPermissionsForRole('role-1', [], ability, 'actor-1')
      ).rejects.toMatchObject({
        status: 400,
        response: { errorKey: 'errors.roles.cannotModifySystem' }
      });
    });

    it('assignPermissionsToRole rejects on system role for non-super caller', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);
      const ability = nonSuperAbility();

      await expect(
        service.assignPermissionsToRole(
          'role-1',
          ['perm-1'],
          undefined,
          ability,
          'actor-1'
        )
      ).rejects.toMatchObject({
        status: 400,
        response: { errorKey: 'errors.roles.cannotModifySystem' }
      });
    });

    it('removePermissionFromRole rejects on system role for non-super caller', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);
      const ability = nonSuperAbility();

      await expect(
        service.removePermissionFromRole('role-1', 'perm-1', ability)
      ).rejects.toMatchObject({
        status: 400,
        response: { errorKey: 'errors.roles.cannotModifySystem' }
      });
    });

    it('super (manage:all) can mutate system-role permissions', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);
      mockRolePermissionRepo.delete.mockResolvedValue({ affected: 1 });
      // @ts-expect-error partial mock
      const ability: AppAbility = { can: jest.fn().mockReturnValue(true) };

      await service.removePermissionFromRole('role-1', 'perm-1', ability);

      expect(mockRolePermissionRepo.delete).toHaveBeenCalledWith({
        roleId: 'role-1',
        permissionId: 'perm-1'
      });
    });

    it('blocks isSystem mutation even when no ability is passed (defense in depth)', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);

      await expect(
        service.removePermissionFromRole('role-1', 'perm-1')
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  // ── Permission-change SSE fan-out to role holders ─────────────────

  describe('RolePermissionsChangedEvent fan-out', () => {
    function expectFannedOutTo(userIds: string[]): void {
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        RolePermissionsChangedEvent.name,
        new RolePermissionsChangedEvent(userIds)
      );
    }

    beforeEach(() => {
      mockUserQueryBuilder.getMany.mockResolvedValue([
        { id: 'u-1' },
        { id: 'u-2' }
      ]);
    });

    it('emits once with all holders on setPermissionsForRole', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);

      await service.setPermissionsForRole('role-2', [
        { permissionId: 'perm-1' }
      ]);

      expectFannedOutTo(['u-1', 'u-2']);
      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
    });

    it('emits once with all holders on assignPermissionsToRole', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockRolePermissionRepo.save.mockResolvedValue([]);

      await service.assignPermissionsToRole('role-2', ['perm-1']);

      expectFannedOutTo(['u-1', 'u-2']);
    });

    it('emits once with all holders on removePermissionFromRole', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockRolePermissionRepo.delete.mockResolvedValue({ affected: 1 });

      await service.removePermissionFromRole('role-2', 'perm-1');

      expectFannedOutTo(['u-1', 'u-2']);
    });

    it('captures holders before deletion on delete', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);

      await service.delete('role-2');

      expectFannedOutTo(['u-1', 'u-2']);
      // Holder query must run before the role is removed.
      const emitOrder = mockEventEmitter.emit.mock.invocationCallOrder[0];
      const removeOrder = mockRoleRepo.remove.mock.invocationCallOrder[0];
      expect(emitOrder).toBeLessThan(removeOrder);
    });

    it('does not emit when the role has no holders', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      mockUserQueryBuilder.getMany.mockResolvedValue([]);
      mockRolePermissionRepo.save.mockResolvedValue([]);

      await service.assignPermissionsToRole('role-2', ['perm-1']);

      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('never emits the token-revoking UserRoleChangedEvent on a permission change', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);

      await service.removePermissionFromRole('role-2', 'perm-1');

      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
        'UserRoleChangedEvent',
        expect.anything()
      );
    });
  });
});
