import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RoleService } from '../services/role.service';
import type { AuditLogParams } from '../../audit/audit.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRoleChangedEvent } from '../events/user-role-changed.event';
import { UserUpdatedEvent } from '../../users/events/user-updated.event';
import type { AppAbility } from '../casl/app-ability';
import {
  LOG_AUDIT_KEY,
  LogAuditOptions
} from '../../audit/decorators/log-audit.decorator';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { MfaRequiredGuard } from '../guards/mfa-required.guard';

function getAuditOptions(
  methodName: keyof RolesController
): LogAuditOptions | undefined {
  return Reflect.getMetadata(
    LOG_AUDIT_KEY,
    RolesController.prototype[methodName]
  ) as LogAuditOptions | undefined;
}

const allowAllGuard = { canActivate: () => true };

// @ts-expect-error partial mock — only `can` is needed for controller delegation tests
const mockAbility: AppAbility = { can: jest.fn().mockReturnValue(true) };

const mockReq: import('../types/auth.request').JwtAuthRequest = {
  // @ts-expect-error partial user — handlers only read req.user.userId
  user: { userId: 'actor-1', email: 'a@example.com' },
  ip: '127.0.0.1',
  headers: {}
};

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
  let eventEmitterMock: { emit: jest.Mock; emitAsync: jest.Mock };

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

    eventEmitterMock = {
      emit: jest.fn(),
      emitAsync: jest.fn().mockResolvedValue([])
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [
        { provide: RoleService, useValue: roleServiceMock },
        { provide: EventEmitter2, useValue: eventEmitterMock }
      ]
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowAllGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(allowAllGuard)
      .overrideGuard(MfaRequiredGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RolesController>(RolesController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // Note: audit logging is exercised by AuditLogInterceptor and verified
  // separately in audit-log.interceptor.spec.ts. Controller unit tests
  // only verify delegation to the service layer.

  describe('findAll', () => {
    it('should return whatever roleService.findAll returns', () => {
      const roles = [{ id: 'role-1', name: 'admin' }];
      roleServiceMock.findAll.mockReturnValue(roles);

      const result = controller.findAll();

      expect(result).toBe(roles);
      expect(roleServiceMock.findAll).toHaveBeenCalled();
    });
  });

  describe('findAllPermissions', () => {
    it('should return whatever roleService.findAllPermissions returns', () => {
      const permissions = [{ id: 'perm-1', name: 'read:users' }];
      roleServiceMock.findAllPermissions.mockReturnValue(permissions);

      const result = controller.findAllPermissions();

      expect(result).toBe(permissions);
      expect(roleServiceMock.findAllPermissions).toHaveBeenCalled();
    });
  });

  // The instance checks run in RoleService (role.service.spec.ts, "instance
  // check of a conditional Role grant"); the controller passes the ability.
  describe('findOne', () => {
    it('passes the ability and the actor to roleService.findOne', async () => {
      const role = { id: 'role-42', name: 'moderator' };
      roleServiceMock.findOne.mockResolvedValue(role);

      const result = await controller.findOne('role-42', mockReq, mockAbility);

      expect(roleServiceMock.findOne).toHaveBeenCalledWith(
        'role-42',
        mockAbility,
        'actor-1'
      );
      expect(result).toBe(role);
    });

    it('propagates a refusal of the service', async () => {
      roleServiceMock.findOne.mockRejectedValue(new ForbiddenException());

      await expect(
        controller.findOne('role-42', mockReq, mockAbility)
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getPermissionsForRole', () => {
    it('passes the ability and the actor to roleService.getPermissionsForRole', async () => {
      const perms = [{ id: 'rp-1' }];
      roleServiceMock.getPermissionsForRole.mockResolvedValue(perms);

      const result = await controller.getPermissionsForRole(
        'role-42',
        mockReq,
        mockAbility
      );

      expect(roleServiceMock.getPermissionsForRole).toHaveBeenCalledWith(
        'role-42',
        mockAbility,
        'actor-1'
      );
      expect(result).toBe(perms);
    });
  });

  describe('create', () => {
    it('passes the dto, the ability and the actor to roleService.create', async () => {
      const dto = { name: 'editor', description: 'Can edit' };
      const role = { id: 'role-new', name: 'editor' };
      roleServiceMock.create.mockResolvedValue(role);

      const result = await controller.create(dto, mockReq, mockAbility);

      expect(roleServiceMock.create).toHaveBeenCalledWith(
        dto,
        mockAbility,
        'actor-1',
        expect.any(Function)
      );
      expect(result).toBe(role);
    });
  });

  describe('update', () => {
    it('passes the dto, the ability and the actor to roleService.update', async () => {
      const dto = { name: 'senior-editor' };
      const updated = { id: 'role-1', name: 'senior-editor' };
      roleServiceMock.update.mockResolvedValue(updated);

      const result = await controller.update(
        'role-1',
        dto,
        mockReq,
        mockAbility
      );

      expect(roleServiceMock.findOne).not.toHaveBeenCalled();
      expect(roleServiceMock.update).toHaveBeenCalledWith(
        'role-1',
        dto,
        mockAbility,
        'actor-1',
        expect.any(Function)
      );
      expect(result).toBe(updated);
    });
  });

  describe('remove', () => {
    it('passes the ability and the actor to roleService.delete', async () => {
      roleServiceMock.delete.mockResolvedValue(undefined);

      const result = await controller.remove('role-1', mockReq, mockAbility);

      expect(roleServiceMock.findOne).not.toHaveBeenCalled();
      expect(roleServiceMock.delete).toHaveBeenCalledWith(
        'role-1',
        mockAbility,
        'actor-1',
        expect.any(Function)
      );
      expect(result).toBeUndefined();
    });
  });

  describe('setPermissions', () => {
    it('should call roleService.setPermissionsForRole with id and dto.items', async () => {
      const items = [{ permissionId: 'perm-1' }, { permissionId: 'perm-2' }];
      const dto = { items };

      await controller.setPermissions('role-1', dto, mockAbility, mockReq);

      expect(roleServiceMock.setPermissionsForRole).toHaveBeenCalledWith(
        'role-1',
        items,
        mockAbility,
        'actor-1',
        expect.objectContaining({ action: AuditAction.PERMISSION_ASSIGN })
      );
    });
  });

  describe('assignPermissions', () => {
    it('should call roleService.assignPermissionsToRole with id, permissionIds and conditions', async () => {
      const dto = {
        permissionIds: ['perm-1', 'perm-2'],
        conditions: undefined
      };

      await controller.assignPermissions('role-1', dto, mockAbility, mockReq);

      expect(roleServiceMock.assignPermissionsToRole).toHaveBeenCalledWith(
        'role-1',
        ['perm-1', 'perm-2'],
        undefined,
        mockAbility,
        'actor-1',
        expect.objectContaining({ action: AuditAction.PERMISSION_ASSIGN })
      );
    });
  });

  describe('removePermission', () => {
    it('should call roleService.removePermissionFromRole with role id, permission id and actor', async () => {
      await controller.removePermission(
        'role-1',
        'perm-5',
        mockAbility,
        mockReq
      );

      expect(roleServiceMock.removePermissionFromRole).toHaveBeenCalledWith(
        'role-1',
        'perm-5',
        mockAbility,
        'actor-1',
        expect.objectContaining({ action: AuditAction.PERMISSION_UNASSIGN })
      );
    });
  });

  describe('assignRole', () => {
    it('should call roleService.assignRoleToUser with userId, roleId and ability', async () => {
      const dto = { roleId: 'role-1' };

      await controller.assignRole('user-99', dto, mockAbility, mockReq);

      expect(roleServiceMock.assignRoleToUser).toHaveBeenCalledWith(
        'user-99',
        'role-1',
        mockAbility,
        'actor-1',
        expect.objectContaining({ action: AuditAction.ROLE_ASSIGN })
      );
    });

    it('should await the session revocation event', async () => {
      await controller.assignRole(
        'user-99',
        { roleId: 'role-1' },
        mockAbility,
        mockReq
      );

      expect(eventEmitterMock.emitAsync).toHaveBeenCalledWith(
        UserRoleChangedEvent.name,
        new UserRoleChangedEvent('user-99')
      );
      expect(eventEmitterMock.emit).toHaveBeenCalledWith(
        UserUpdatedEvent.name,
        new UserUpdatedEvent('user-99')
      );
    });

    it('should fail the request when the revocation listener rejects', async () => {
      eventEmitterMock.emitAsync.mockRejectedValue(new Error('db down'));

      await expect(
        controller.assignRole(
          'user-99',
          { roleId: 'role-1' },
          mockAbility,
          mockReq
        )
      ).rejects.toThrow('db down');
      expect(eventEmitterMock.emit).not.toHaveBeenCalled();
    });
  });

  describe('removeRole', () => {
    it('should call roleService.removeRoleFromUser with userId, roleId, ability and actor', async () => {
      await controller.removeRole('user-99', 'role-1', mockAbility, mockReq);

      expect(roleServiceMock.removeRoleFromUser).toHaveBeenCalledWith(
        'user-99',
        'role-1',
        mockAbility,
        'actor-1',
        expect.objectContaining({ action: AuditAction.ROLE_UNASSIGN })
      );
    });

    it('should return undefined (void response)', async () => {
      const result = await controller.removeRole(
        'user-99',
        'role-1',
        mockAbility,
        mockReq
      );

      expect(result).toBeUndefined();
    });

    it('should await the session revocation event', async () => {
      await controller.removeRole('user-99', 'role-1', mockAbility, mockReq);

      expect(eventEmitterMock.emitAsync).toHaveBeenCalledWith(
        UserRoleChangedEvent.name,
        new UserRoleChangedEvent('user-99')
      );
      expect(eventEmitterMock.emit).toHaveBeenCalledWith(
        UserUpdatedEvent.name,
        new UserUpdatedEvent('user-99')
      );
    });

    it('should fail the request when the revocation listener rejects', async () => {
      eventEmitterMock.emitAsync.mockRejectedValue(new Error('db down'));

      await expect(
        controller.removeRole('user-99', 'role-1', mockAbility, mockReq)
      ).rejects.toThrow('db down');
      expect(eventEmitterMock.emit).not.toHaveBeenCalled();
    });
  });

  // Each row goes to the service, which writes it in the transaction of the
  // change, so a role change never commits without its row.
  describe('audit rows', () => {
    const actorFields = {
      actorId: 'actor-1',
      actorEmail: 'a@example.com',
      context: { ip: '127.0.0.1', requestId: undefined }
    };

    it.each([
      'create',
      'update',
      'remove',
      'setPermissions',
      'assignPermissions',
      'removePermission',
      'assignRole',
      'removeRole'
    ] as const)(
      '%s: no @LogAudit metadata, the row is not fire-and-forget',
      (method) => {
        expect(getAuditOptions(method)).toBeUndefined();
      }
    );

    it('create: ROLE_CREATE on the created role with the name', async () => {
      await controller.create({ name: 'editor' }, mockReq, mockAbility);

      const [, , , row] = roleServiceMock.create.mock.calls[0] as [
        unknown,
        unknown,
        unknown,
        (role: { id: string }) => AuditLogParams
      ];
      expect(row({ id: 'role-new' })).toEqual({
        ...actorFields,
        action: AuditAction.ROLE_CREATE,
        targetType: 'Role',
        targetId: 'role-new',
        details: { name: 'editor' }
      });
    });

    it('update: ROLE_UPDATE lists only the fields that differ from the stored role', async () => {
      await controller.update(
        'role-1',
        { name: 'editor', description: 'new' },
        mockReq,
        mockAbility
      );

      const [, , , , row] = roleServiceMock.update.mock.calls[0] as [
        unknown,
        unknown,
        unknown,
        unknown,
        (before: { name: string; description: string }) => AuditLogParams
      ];
      expect(row({ name: 'editor', description: 'old' })).toEqual({
        ...actorFields,
        action: AuditAction.ROLE_UPDATE,
        targetType: 'Role',
        targetId: 'role-1',
        details: { changedFields: ['description'] }
      });
    });

    it('remove: ROLE_DELETE records the name of the deleted role', async () => {
      await controller.remove('role-1', mockReq, mockAbility);

      const [, , , row] = roleServiceMock.delete.mock.calls[0] as [
        unknown,
        unknown,
        unknown,
        (role: { name: string }) => AuditLogParams
      ];
      expect(row({ name: 'editor' })).toEqual({
        ...actorFields,
        action: AuditAction.ROLE_DELETE,
        targetType: 'Role',
        targetId: 'role-1',
        details: { name: 'editor' }
      });
    });

    it('setPermissions: PERMISSION_ASSIGN with permissionIds from items', async () => {
      await controller.setPermissions(
        'role-1',
        { items: [{ permissionId: 'p1' }, { permissionId: 'p2' }] },
        mockAbility,
        mockReq
      );

      expect(roleServiceMock.setPermissionsForRole).toHaveBeenCalledWith(
        'role-1',
        expect.any(Array),
        mockAbility,
        'actor-1',
        {
          ...actorFields,
          action: AuditAction.PERMISSION_ASSIGN,
          targetType: 'Role',
          targetId: 'role-1',
          details: { permissionIds: ['p1', 'p2'] }
        }
      );
    });

    it('assignPermissions: PERMISSION_ASSIGN with permissionIds from body', async () => {
      await controller.assignPermissions(
        'role-1',
        { permissionIds: ['p1', 'p2'] },
        mockAbility,
        mockReq
      );

      expect(roleServiceMock.assignPermissionsToRole).toHaveBeenCalledWith(
        'role-1',
        ['p1', 'p2'],
        undefined,
        mockAbility,
        'actor-1',
        {
          ...actorFields,
          action: AuditAction.PERMISSION_ASSIGN,
          targetType: 'Role',
          targetId: 'role-1',
          details: { permissionIds: ['p1', 'p2'] }
        }
      );
    });

    it('removePermission: PERMISSION_UNASSIGN with the permission id', async () => {
      await controller.removePermission(
        'role-1',
        'perm-5',
        mockAbility,
        mockReq
      );

      expect(roleServiceMock.removePermissionFromRole).toHaveBeenCalledWith(
        'role-1',
        'perm-5',
        mockAbility,
        'actor-1',
        {
          ...actorFields,
          action: AuditAction.PERMISSION_UNASSIGN,
          targetType: 'Role',
          targetId: 'role-1',
          details: { permissionId: 'perm-5' }
        }
      );
    });

    it('assignRole: ROLE_ASSIGN on the user with the role id', async () => {
      await controller.assignRole(
        'user-99',
        { roleId: 'role-1' },
        mockAbility,
        mockReq
      );

      expect(roleServiceMock.assignRoleToUser).toHaveBeenCalledWith(
        'user-99',
        'role-1',
        mockAbility,
        'actor-1',
        {
          ...actorFields,
          action: AuditAction.ROLE_ASSIGN,
          targetType: 'User',
          targetId: 'user-99',
          details: { roleId: 'role-1' }
        }
      );
    });

    it('removeRole: ROLE_UNASSIGN on the user with the role id', async () => {
      await controller.removeRole('user-99', 'role-1', mockAbility, mockReq);

      expect(roleServiceMock.removeRoleFromUser).toHaveBeenCalledWith(
        'user-99',
        'role-1',
        mockAbility,
        'actor-1',
        {
          ...actorFields,
          action: AuditAction.ROLE_UNASSIGN,
          targetType: 'User',
          targetId: 'user-99',
          details: { roleId: 'role-1' }
        }
      );
    });
  });
});
