import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RoleService } from '../services/role.service';
import { AuditService } from '../../audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AppAbility } from '../casl/app-ability';
import {
  LOG_AUDIT_KEY,
  LogAuditDetailsContext,
  LogAuditOptions
} from '../../audit/decorators/log-audit.decorator';
import { AuditAction } from '@app/shared/enums/audit-action.enum';

function getAuditOptions(
  methodName: keyof RolesController
): LogAuditOptions | undefined {
  return Reflect.getMetadata(
    LOG_AUDIT_KEY,
    RolesController.prototype[methodName]
  ) as LogAuditOptions | undefined;
}

function detailsCtx(
  body: unknown,
  params: Record<string, string> = {}
): LogAuditDetailsContext {
  // @ts-expect-error partial Request — details() callbacks only read body/params
  return { request: {}, response: {}, params, body };
}

const allowAllGuard = { canActivate: () => true };

// @ts-expect-error partial mock — only `can` is needed for controller delegation tests
const mockAbility: AppAbility = { can: jest.fn().mockReturnValue(true) };

// @ts-expect-error partial mock — drives the deny path of assertCan
const denyAbility: AppAbility = { can: jest.fn().mockReturnValue(false) };

const mockReq: import('../types/auth.request').JwtAuthRequest = {
  // @ts-expect-error partial user — handlers only read req.user.userId
  user: { userId: 'actor-1', email: 'a@example.com' }
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
  let auditServiceMock: { log: jest.Mock; logFireAndForget: jest.Mock };
  let metricsServiceMock: { recordPermissionDenied: jest.Mock };

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
      log: jest.fn().mockResolvedValue(undefined),
      logFireAndForget: jest.fn()
    };
    metricsServiceMock = { recordPermissionDenied: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [
        { provide: RoleService, useValue: roleServiceMock },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: AuditService, useValue: auditServiceMock },
        { provide: MetricsService, useValue: metricsServiceMock }
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

  describe('findOne', () => {
    it('should load the role and return it when ability allows', async () => {
      const role = { id: 'role-42', name: 'moderator' };
      roleServiceMock.findOne.mockResolvedValue(role);

      const result = await controller.findOne('role-42', mockReq, mockAbility);

      expect(roleServiceMock.findOne).toHaveBeenCalledWith('role-42');
      expect(result).toBe(role);
    });

    it('should throw ForbiddenException when ability denies the loaded role instance', async () => {
      const role = { id: 'role-42', name: 'system', isSystem: true };
      roleServiceMock.findOne.mockResolvedValue(role);

      await expect(
        controller.findOne('role-42', mockReq, denyAbility)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(auditServiceMock.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PERMISSION_CHECK_FAILURE,
          actorId: 'actor-1',
          targetId: 'role-42',
          targetType: 'Role'
        })
      );
    });
  });

  describe('getPermissionsForRole', () => {
    it('should load the role, assert read access, then delegate to roleService.getPermissionsForRole', async () => {
      const role = { id: 'role-42', name: 'moderator' };
      const perms = [{ id: 'rp-1' }];
      roleServiceMock.findOne.mockResolvedValue(role);
      roleServiceMock.getPermissionsForRole.mockResolvedValue(perms);

      const result = await controller.getPermissionsForRole(
        'role-42',
        mockReq,
        mockAbility
      );

      expect(roleServiceMock.findOne).toHaveBeenCalledWith('role-42');
      expect(roleServiceMock.getPermissionsForRole).toHaveBeenCalledWith(
        'role-42'
      );
      expect(result).toBe(perms);
    });

    it('should throw ForbiddenException and skip getPermissionsForRole when ability denies', async () => {
      const role = { id: 'role-42', name: 'moderator' };
      roleServiceMock.findOne.mockResolvedValue(role);

      await expect(
        controller.getPermissionsForRole('role-42', mockReq, denyAbility)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(roleServiceMock.getPermissionsForRole).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should call roleService.create with the dto and return the role', async () => {
      const dto = { name: 'editor', description: 'Can edit' };
      const role = { id: 'role-new', name: 'editor' };
      roleServiceMock.create.mockResolvedValue(role);

      const result = await controller.create(dto);

      expect(roleServiceMock.create).toHaveBeenCalledWith(dto);
      expect(result).toBe(role);
    });
  });

  describe('update', () => {
    it('should load the role, assert update access, then call roleService.update', async () => {
      const dto = { name: 'senior-editor' };
      const role = { id: 'role-1', name: 'editor' };
      const updated = { id: 'role-1', name: 'senior-editor' };
      roleServiceMock.findOne.mockResolvedValue(role);
      roleServiceMock.update.mockResolvedValue(updated);

      const result = await controller.update(
        'role-1',
        dto,
        mockReq,
        mockAbility
      );

      expect(roleServiceMock.findOne).toHaveBeenCalledWith('role-1');
      expect(roleServiceMock.update).toHaveBeenCalledWith('role-1', dto);
      expect(result).toBe(updated);
    });

    it('should throw ForbiddenException and skip update when ability denies the loaded role', async () => {
      const role = { id: 'role-1', name: 'editor' };
      roleServiceMock.findOne.mockResolvedValue(role);

      await expect(
        controller.update('role-1', { name: 'x' }, mockReq, denyAbility)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(roleServiceMock.update).not.toHaveBeenCalled();
      expect(metricsServiceMock.recordPermissionDenied).toHaveBeenCalledWith(
        'instance',
        'update',
        'Role'
      );
    });
  });

  describe('remove', () => {
    it('should load the role, assert delete access, then call roleService.delete', async () => {
      const role = { id: 'role-1', name: 'editor' };
      roleServiceMock.findOne.mockResolvedValue(role);
      roleServiceMock.delete.mockResolvedValue(undefined);

      const result = await controller.remove('role-1', mockReq, mockAbility);

      expect(roleServiceMock.findOne).toHaveBeenCalledWith('role-1');
      expect(roleServiceMock.delete).toHaveBeenCalledWith('role-1');
      expect(result).toBeUndefined();
    });

    it('should throw ForbiddenException and skip delete when ability denies the loaded role', async () => {
      const role = { id: 'role-1', name: 'editor' };
      roleServiceMock.findOne.mockResolvedValue(role);

      await expect(
        controller.remove('role-1', mockReq, denyAbility)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(roleServiceMock.delete).not.toHaveBeenCalled();
      expect(metricsServiceMock.recordPermissionDenied).toHaveBeenCalledWith(
        'instance',
        'delete',
        'Role'
      );
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
        'actor-1'
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
        'actor-1'
      );
    });
  });

  describe('removePermission', () => {
    it('should call roleService.removePermissionFromRole with role id and permission id', async () => {
      await controller.removePermission('role-1', 'perm-5', mockAbility);

      expect(roleServiceMock.removePermissionFromRole).toHaveBeenCalledWith(
        'role-1',
        'perm-5',
        mockAbility
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
        'actor-1'
      );
    });
  });

  describe('removeRole', () => {
    it('should call roleService.removeRoleFromUser with userId, roleId and ability', async () => {
      await controller.removeRole('user-99', 'role-1', mockAbility);

      expect(roleServiceMock.removeRoleFromUser).toHaveBeenCalledWith(
        'user-99',
        'role-1',
        mockAbility
      );
    });

    it('should return undefined (void response)', async () => {
      const result = await controller.removeRole(
        'user-99',
        'role-1',
        mockAbility
      );

      expect(result).toBeUndefined();
    });
  });

  describe('@LogAudit metadata', () => {
    it('create: ROLE_CREATE with id from response and name in details', () => {
      const opts = getAuditOptions('create');
      expect(opts?.action).toBe(AuditAction.ROLE_CREATE);
      expect(opts?.targetType).toBe('Role');
      expect(opts?.targetIdFromResponse?.({ id: 'role-new' })).toBe('role-new');
      expect(opts?.details?.(detailsCtx({ name: 'editor' }))).toEqual({
        name: 'editor'
      });
    });

    it('update: ROLE_UPDATE with changedFields in details', () => {
      const opts = getAuditOptions('update');
      expect(opts?.action).toBe(AuditAction.ROLE_UPDATE);
      expect(opts?.targetType).toBe('Role');
      expect(
        opts?.details?.(detailsCtx({ name: 'x', description: 'y' }))
      ).toEqual({ changedFields: ['name', 'description'] });
    });

    it('remove: ROLE_DELETE with no details', () => {
      const opts = getAuditOptions('remove');
      expect(opts?.action).toBe(AuditAction.ROLE_DELETE);
      expect(opts?.targetType).toBe('Role');
      expect(opts?.details).toBeUndefined();
      expect(opts?.targetIdParam).toBeUndefined();
    });

    it('setPermissions: PERMISSION_ASSIGN with permissionIds from items', () => {
      const opts = getAuditOptions('setPermissions');
      expect(opts?.action).toBe(AuditAction.PERMISSION_ASSIGN);
      expect(opts?.targetType).toBe('Role');
      expect(
        opts?.details?.(
          detailsCtx({
            items: [{ permissionId: 'p1' }, { permissionId: 'p2' }]
          })
        )
      ).toEqual({ permissionIds: ['p1', 'p2'] });
    });

    it('assignPermissions: PERMISSION_ASSIGN with permissionIds from body', () => {
      const opts = getAuditOptions('assignPermissions');
      expect(opts?.action).toBe(AuditAction.PERMISSION_ASSIGN);
      expect(opts?.targetType).toBe('Role');
      expect(
        opts?.details?.(detailsCtx({ permissionIds: ['p1', 'p2'] }))
      ).toEqual({ permissionIds: ['p1', 'p2'] });
    });

    it('removePermission: PERMISSION_UNASSIGN with permissionId from params', () => {
      const opts = getAuditOptions('removePermission');
      expect(opts?.action).toBe(AuditAction.PERMISSION_UNASSIGN);
      expect(opts?.targetType).toBe('Role');
      expect(
        opts?.details?.(detailsCtx({}, { permissionId: 'perm-5' }))
      ).toEqual({ permissionId: 'perm-5' });
    });

    it('assignRole: ROLE_ASSIGN on User with userId param and roleId in details', () => {
      const opts = getAuditOptions('assignRole');
      expect(opts?.action).toBe(AuditAction.ROLE_ASSIGN);
      expect(opts?.targetType).toBe('User');
      expect(opts?.targetIdParam).toBe('userId');
      expect(opts?.details?.(detailsCtx({ roleId: 'role-1' }))).toEqual({
        roleId: 'role-1'
      });
    });

    it('removeRole: ROLE_UNASSIGN on User with userId param and roleId from params', () => {
      const opts = getAuditOptions('removeRole');
      expect(opts?.action).toBe(AuditAction.ROLE_UNASSIGN);
      expect(opts?.targetType).toBe('User');
      expect(opts?.targetIdParam).toBe('userId');
      expect(opts?.details?.(detailsCtx({}, { roleId: 'role-1' }))).toEqual({
        roleId: 'role-1'
      });
    });
  });
});
