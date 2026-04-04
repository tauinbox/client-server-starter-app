import { Test, TestingModule } from '@nestjs/testing';
import { RolesController } from './roles.controller';
import { RoleService } from '../services/role.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { JwtAuthRequest } from '../types/auth.request';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AppAbility } from '../casl/app-ability';

const allowAllGuard = { canActivate: () => true };

// @ts-expect-error partial mock — only `can` is needed for controller delegation tests
const mockAbility: AppAbility = { can: jest.fn().mockReturnValue(true) };

function mockJwtRequest(
  userId = 'user-1',
  email = 'admin@example.com'
): {
  user: JwtAuthRequest['user'];
  ip: string;
  headers: Record<string, string>;
} {
  return {
    user: { userId, email, roles: [] },
    ip: '127.0.0.1',
    headers: {}
  };
}

describe('RolesController', () => {
  let controller: RolesController;
  let roleServiceMock: {
    findAll: jest.Mock;
    findAllPermissions: jest.Mock;
    findOne: jest.Mock;
    getPermissionsForRole: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    setPermissionsForRole: jest.Mock;
    assignPermissionsToRole: jest.Mock;
    removePermissionFromRole: jest.Mock;
    assignRoleToUser: jest.Mock;
    removeRoleFromUser: jest.Mock;
  };
  let auditServiceMock: {
    log: jest.Mock;
  };

  beforeEach(async () => {
    roleServiceMock = {
      findAll: jest.fn().mockResolvedValue([]),
      findAllPermissions: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'role-1', name: 'editor' }),
      getPermissionsForRole: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'role-new', name: 'editor' }),
      update: jest.fn().mockResolvedValue({ id: 'role-1', name: 'editor' }),
      delete: jest.fn().mockResolvedValue(undefined),
      setPermissionsForRole: jest.fn().mockResolvedValue(undefined),
      assignPermissionsToRole: jest.fn().mockResolvedValue(undefined),
      removePermissionFromRole: jest.fn().mockResolvedValue(undefined),
      assignRoleToUser: jest.fn().mockResolvedValue(undefined),
      removeRoleFromUser: jest.fn().mockResolvedValue(undefined)
    };

    auditServiceMock = {
      log: jest.fn().mockResolvedValue(undefined)
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [
        { provide: RoleService, useValue: roleServiceMock },
        { provide: AuditService, useValue: auditServiceMock },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } }
      ]
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowAllGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(allowAllGuard)
      .compile();

    controller = module.get<RolesController>(RolesController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── findAll ───────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return whatever roleService.findAll returns', () => {
      const roles = [{ id: 'role-1', name: 'admin' }];
      roleServiceMock.findAll.mockReturnValue(roles);

      const result = controller.findAll();

      expect(result).toBe(roles);
      expect(roleServiceMock.findAll).toHaveBeenCalled();
    });
  });

  // ── findAllPermissions ────────────────────────────────────────────

  describe('findAllPermissions', () => {
    it('should return whatever roleService.findAllPermissions returns', () => {
      const permissions = [{ id: 'perm-1', name: 'read:users' }];
      roleServiceMock.findAllPermissions.mockReturnValue(permissions);

      const result = controller.findAllPermissions();

      expect(result).toBe(permissions);
      expect(roleServiceMock.findAllPermissions).toHaveBeenCalled();
    });
  });

  // ── findOne ───────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should delegate to roleService.findOne with the correct id', () => {
      const role = { id: 'role-42', name: 'moderator' };
      roleServiceMock.findOne.mockReturnValue(role);

      const result = controller.findOne('role-42');

      expect(roleServiceMock.findOne).toHaveBeenCalledWith('role-42');
      expect(result).toBe(role);
    });
  });

  // ── getPermissionsForRole ─────────────────────────────────────────

  describe('getPermissionsForRole', () => {
    it('should delegate to roleService.getPermissionsForRole with the correct id', () => {
      const perms = [{ id: 'rp-1' }];
      roleServiceMock.getPermissionsForRole.mockReturnValue(perms);

      const result = controller.getPermissionsForRole('role-42');

      expect(roleServiceMock.getPermissionsForRole).toHaveBeenCalledWith(
        'role-42'
      );
      expect(result).toBe(perms);
    });
  });

  // ── create ────────────────────────────────────────────────────────

  describe('create', () => {
    it('should call roleService.create with the dto and return the role', async () => {
      const dto = { name: 'editor', description: 'Can edit' };
      const role = { id: 'role-new', name: 'editor' };
      roleServiceMock.create.mockResolvedValue(role);
      const req = mockJwtRequest() as JwtAuthRequest;

      const result = await controller.create(dto, req);

      expect(roleServiceMock.create).toHaveBeenCalledWith(dto);
      expect(result).toBe(role);
    });

    it('should log ROLE_CREATE with the created role id and name', async () => {
      const dto = { name: 'editor', description: 'Can edit' };
      const role = { id: 'role-new', name: 'editor' };
      roleServiceMock.create.mockResolvedValue(role);
      const req = mockJwtRequest(
        'user-5',
        'admin@example.com'
      ) as JwtAuthRequest;

      await controller.create(dto, req);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ROLE_CREATE,
          actorId: 'user-5',
          actorEmail: 'admin@example.com',
          targetId: 'role-new',
          targetType: 'Role',
          details: { name: 'editor' }
        })
      );
    });
  });

  // ── update ────────────────────────────────────────────────────────

  describe('update', () => {
    it('should call roleService.update with the correct id and dto and return result', async () => {
      const dto = { name: 'senior-editor' };
      const updated = { id: 'role-1', name: 'senior-editor' };
      roleServiceMock.update.mockResolvedValue(updated);
      const req = mockJwtRequest() as JwtAuthRequest;

      const result = await controller.update('role-1', dto, req);

      expect(roleServiceMock.update).toHaveBeenCalledWith('role-1', dto);
      expect(result).toBe(updated);
    });

    it('should log ROLE_UPDATE with changedFields derived from dto keys', async () => {
      const dto = { name: 'senior-editor', description: 'Updated desc' };
      const req = mockJwtRequest('user-7', 'mod@example.com') as JwtAuthRequest;

      await controller.update('role-1', dto, req);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ROLE_UPDATE,
          actorId: 'user-7',
          actorEmail: 'mod@example.com',
          targetId: 'role-1',
          targetType: 'Role',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          details: expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            changedFields: expect.arrayContaining(['name', 'description'])
          })
        })
      );
    });
  });

  // ── remove ────────────────────────────────────────────────────────

  describe('remove', () => {
    it('should call roleService.delete with the correct id and return result', async () => {
      roleServiceMock.delete.mockResolvedValue(undefined);
      const req = mockJwtRequest() as JwtAuthRequest;

      const result = await controller.remove('role-1', req);

      expect(roleServiceMock.delete).toHaveBeenCalledWith('role-1');
      expect(result).toBeUndefined();
    });

    it('should log ROLE_DELETE with the correct targetId', async () => {
      const req = mockJwtRequest(
        'user-3',
        'deleter@example.com'
      ) as JwtAuthRequest;

      await controller.remove('role-1', req);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ROLE_DELETE,
          actorId: 'user-3',
          actorEmail: 'deleter@example.com',
          targetId: 'role-1',
          targetType: 'Role'
        })
      );
    });
  });

  // ── setPermissions ────────────────────────────────────────────────

  describe('setPermissions', () => {
    it('should call roleService.setPermissionsForRole with id and dto.items', async () => {
      const items = [{ permissionId: 'perm-1' }, { permissionId: 'perm-2' }];
      const dto = { items };
      const req = mockJwtRequest() as JwtAuthRequest;

      await controller.setPermissions('role-1', dto, req);

      expect(roleServiceMock.setPermissionsForRole).toHaveBeenCalledWith(
        'role-1',
        items
      );
    });

    it('should log PERMISSION_ASSIGN with the permissionIds from dto.items', async () => {
      const items = [{ permissionId: 'perm-1' }, { permissionId: 'perm-2' }];
      const dto = { items };
      const req = mockJwtRequest(
        'user-8',
        'admin@example.com'
      ) as JwtAuthRequest;

      await controller.setPermissions('role-1', dto, req);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PERMISSION_ASSIGN,
          actorId: 'user-8',
          actorEmail: 'admin@example.com',
          targetId: 'role-1',
          targetType: 'Role',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          details: expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            permissionIds: expect.arrayContaining(['perm-1', 'perm-2'])
          })
        })
      );
    });
  });

  // ── assignPermissions ─────────────────────────────────────────────

  describe('assignPermissions', () => {
    it('should call roleService.assignPermissionsToRole with id, permissionIds and conditions', async () => {
      const dto = {
        permissionIds: ['perm-1', 'perm-2'],
        conditions: undefined
      };
      const req = mockJwtRequest() as JwtAuthRequest;

      await controller.assignPermissions('role-1', dto, req);

      expect(roleServiceMock.assignPermissionsToRole).toHaveBeenCalledWith(
        'role-1',
        ['perm-1', 'perm-2'],
        undefined
      );
    });

    it('should log PERMISSION_ASSIGN with permissionIds', async () => {
      const dto = { permissionIds: ['perm-3'], conditions: undefined };
      const req = mockJwtRequest(
        'user-9',
        'admin@example.com'
      ) as JwtAuthRequest;

      await controller.assignPermissions('role-1', dto, req);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PERMISSION_ASSIGN,
          actorId: 'user-9',
          actorEmail: 'admin@example.com',
          targetId: 'role-1',
          targetType: 'Role',
          details: { permissionIds: ['perm-3'] }
        })
      );
    });
  });

  // ── removePermission ──────────────────────────────────────────────

  describe('removePermission', () => {
    it('should call roleService.removePermissionFromRole with role id and permission id', async () => {
      const req = mockJwtRequest() as JwtAuthRequest;

      await controller.removePermission('role-1', 'perm-5', req);

      expect(roleServiceMock.removePermissionFromRole).toHaveBeenCalledWith(
        'role-1',
        'perm-5'
      );
    });

    it('should log PERMISSION_UNASSIGN with the removed permissionId', async () => {
      const req = mockJwtRequest(
        'user-10',
        'admin@example.com'
      ) as JwtAuthRequest;

      await controller.removePermission('role-1', 'perm-5', req);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PERMISSION_UNASSIGN,
          actorId: 'user-10',
          actorEmail: 'admin@example.com',
          targetId: 'role-1',
          targetType: 'Role',
          details: { permissionId: 'perm-5' }
        })
      );
    });
  });

  // ── assignRole ────────────────────────────────────────────────────

  describe('assignRole', () => {
    it('should call roleService.assignRoleToUser with userId, roleId and ability', async () => {
      const dto = { roleId: 'role-1' };
      const req = mockJwtRequest() as JwtAuthRequest;

      await controller.assignRole('user-99', dto, req, mockAbility);

      expect(roleServiceMock.assignRoleToUser).toHaveBeenCalledWith(
        'user-99',
        'role-1',
        mockAbility
      );
    });

    it('should log ROLE_ASSIGN with the roleId targeting the user', async () => {
      const dto = { roleId: 'role-1' };
      const req = mockJwtRequest(
        'user-1',
        'admin@example.com'
      ) as JwtAuthRequest;

      await controller.assignRole('user-99', dto, req, mockAbility);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ROLE_ASSIGN,
          actorId: 'user-1',
          actorEmail: 'admin@example.com',
          targetId: 'user-99',
          targetType: 'User',
          details: { roleId: 'role-1' }
        })
      );
    });
  });

  // ── removeRole ────────────────────────────────────────────────────

  describe('removeRole', () => {
    it('should call roleService.removeRoleFromUser with userId, roleId and ability', async () => {
      const req = mockJwtRequest() as JwtAuthRequest;

      await controller.removeRole('user-99', 'role-1', req, mockAbility);

      expect(roleServiceMock.removeRoleFromUser).toHaveBeenCalledWith(
        'user-99',
        'role-1',
        mockAbility
      );
    });

    it('should log ROLE_UNASSIGN targeting the user with the roleId', async () => {
      const req = mockJwtRequest(
        'user-1',
        'admin@example.com'
      ) as JwtAuthRequest;

      await controller.removeRole('user-99', 'role-1', req, mockAbility);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ROLE_UNASSIGN,
          actorId: 'user-1',
          actorEmail: 'admin@example.com',
          targetId: 'user-99',
          targetType: 'User',
          details: { roleId: 'role-1' }
        })
      );
    });

    it('should return undefined (void response)', async () => {
      const req = mockJwtRequest() as JwtAuthRequest;

      const result = await controller.removeRole(
        'user-99',
        'role-1',
        req,
        mockAbility
      );

      expect(result).toBeUndefined();
    });
  });
});
