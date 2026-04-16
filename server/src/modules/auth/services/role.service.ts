import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { User } from '../../users/entities/user.entity';
import { PermissionService } from './permission.service';
import { PermissionCondition } from '@app/shared/types';
import { ErrorKeys } from '@app/shared/constants/error-keys';
import type { AppAbility } from '../casl/app-ability';
import {
  assertCanGrantPermissions,
  type ResolvedGrantItem
} from '../utils/can-grant.util';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { assertCan } from '../../../common/utils/assert-can.util';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService
  ) {}

  private async resolveGrantItems(
    items: { permissionId: string; conditions?: PermissionCondition | null }[]
  ): Promise<ResolvedGrantItem[]> {
    if (items.length === 0) return [];
    const permissions = await this.permissionRepository.find({
      where: items.map((i) => ({ id: i.permissionId }))
    });
    const byId = new Map(permissions.map((p) => [p.id, p]));
    return items.map((i) => {
      const p = byId.get(i.permissionId);
      if (!p) {
        throw new HttpException(
          {
            message: `Permission ${i.permissionId} not found`,
            errorKey: ErrorKeys.GENERAL.RESOURCE_NOT_FOUND
          },
          HttpStatus.BAD_REQUEST
        );
      }
      return {
        permissionId: p.id,
        actionName: p.action.name,
        subject: p.resource.subject,
        bodyConditions: i.conditions ?? null
      };
    });
  }

  private async assertGrantAllowed(
    ability: AppAbility | undefined,
    items: { permissionId: string; conditions?: PermissionCondition | null }[],
    context: { actorId?: string; roleId: string }
  ): Promise<void> {
    if (!ability) return;
    if (ability.can('manage', 'all')) return;
    const resolved = await this.resolveGrantItems(items);
    try {
      assertCanGrantPermissions(ability, resolved);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === 403) {
        const body = err.getResponse();
        this.auditService.logFireAndForget({
          action: AuditAction.PERMISSION_GRANT_DENIED,
          actorId: context.actorId ?? null,
          targetId: context.roleId,
          targetType: 'Role',
          details:
            typeof body === 'object' && body !== null
              ? ((body as { details?: Record<string, unknown> }).details ?? {
                  body
                })
              : { message: String(body) }
        });
      }
      throw err;
    }
  }

  private assertNotSystem(role: Role, ability?: AppAbility): void {
    if (!role.isSystem) return;
    if (ability && ability.can('manage', 'all')) return;
    throw new HttpException(
      {
        message: 'Cannot modify system roles',
        errorKey: ErrorKeys.ROLES.CANNOT_MODIFY_SYSTEM
      },
      HttpStatus.BAD_REQUEST
    );
  }

  async findAll(): Promise<Role[]> {
    return this.roleRepository.find({
      order: { name: 'ASC' }
    });
  }

  async findOne(id: string): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { id } });
    if (!role) {
      throw new HttpException(
        { message: 'Role not found', errorKey: ErrorKeys.ROLES.NOT_FOUND },
        HttpStatus.NOT_FOUND
      );
    }
    return role;
  }

  async create(data: {
    name: string;
    description?: string;
    isSuper?: boolean;
  }): Promise<Role> {
    if (data.isSuper !== undefined) {
      throw new HttpException(
        {
          message: 'isSuper flag cannot be set via API',
          errorKey: ErrorKeys.ROLES.SUPER_FLAG_FORBIDDEN
        },
        HttpStatus.BAD_REQUEST
      );
    }
    const existing = await this.roleRepository.findOne({
      where: { name: data.name }
    });
    if (existing) {
      throw new HttpException(
        {
          message: 'Role with this name already exists',
          errorKey: ErrorKeys.ROLES.NAME_EXISTS
        },
        HttpStatus.BAD_REQUEST
      );
    }
    const role = this.roleRepository.create({ ...data, isSuper: false });
    return this.roleRepository.save(role);
  }

  async update(
    id: string,
    data: { name?: string; description?: string; isSuper?: boolean }
  ): Promise<Role> {
    const role = await this.findOne(id);
    if (role.isSystem) {
      throw new HttpException(
        {
          message: 'Cannot modify system roles',
          errorKey: ErrorKeys.ROLES.CANNOT_MODIFY_SYSTEM
        },
        HttpStatus.BAD_REQUEST
      );
    }
    if (data.isSuper !== undefined) {
      throw new HttpException(
        {
          message: 'isSuper flag cannot be changed via API',
          errorKey: ErrorKeys.ROLES.SUPER_FLAG_FORBIDDEN
        },
        HttpStatus.BAD_REQUEST
      );
    }
    if (data.name) {
      const existing = await this.roleRepository.findOne({
        where: { name: data.name }
      });
      if (existing && existing.id !== id) {
        throw new HttpException(
          {
            message: 'Role with this name already exists',
            errorKey: ErrorKeys.ROLES.NAME_EXISTS
          },
          HttpStatus.BAD_REQUEST
        );
      }
    }
    Object.assign(role, data);
    return this.roleRepository.save(role);
  }

  async delete(id: string): Promise<void> {
    const role = await this.findOne(id);
    if (role.isSystem) {
      throw new HttpException(
        {
          message: 'Cannot delete system roles',
          errorKey: ErrorKeys.ROLES.CANNOT_DELETE_SYSTEM
        },
        HttpStatus.BAD_REQUEST
      );
    }
    await this.invalidateUsersWithRole(id);
    await this.roleRepository.remove(role);
  }

  async assignRoleToUser(
    userId: string,
    roleId: string,
    ability?: AppAbility,
    actorId?: string
  ): Promise<void> {
    const role = await this.findOne(roleId);

    if (ability) {
      if (role.isSuper) {
        throw new ForbiddenException('Cannot assign super roles');
      }
      const targetUser = await this.roleRepository.manager.findOne(User, {
        where: { id: userId }
      });
      if (targetUser) {
        assertCan(ability, 'update', targetUser, this.auditService, {
          actorId,
          targetId: userId,
          targetType: 'User'
        });
      }

      // Prevent indirect escalation: caller must hold every permission
      // carried by the role they are assigning.
      const rolePermissions = await this.rolePermissionRepository.find({
        where: { roleId }
      });
      const grantItems = rolePermissions.map((rp) => ({
        permissionId: rp.permissionId,
        conditions: rp.conditions ?? null
      }));
      await this.assertGrantAllowed(ability, grantItems, { actorId, roleId });
    }

    await this.roleRepository.manager
      .createQueryBuilder()
      .relation(User, 'roles')
      .of(userId)
      .add(roleId);
    await this.permissionService.invalidateUserCache(userId);
  }

  async removeRoleFromUser(
    userId: string,
    roleId: string,
    ability?: AppAbility
  ): Promise<void> {
    const role = await this.findOne(roleId);

    if (ability) {
      if (role.isSuper) {
        throw new ForbiddenException('Cannot remove super roles');
      }
      const targetUser = await this.roleRepository.manager.findOne(User, {
        where: { id: userId }
      });
      if (targetUser) {
        assertCan(ability, 'update', targetUser, this.auditService, {
          targetId: userId,
          targetType: 'User'
        });
      }
    }

    await this.roleRepository.manager
      .createQueryBuilder()
      .relation(User, 'roles')
      .of(userId)
      .remove(roleId);
    await this.permissionService.invalidateUserCache(userId);
  }

  async findRolesForUser(userId: string): Promise<Role[]> {
    return this.roleRepository
      .createQueryBuilder('role')
      .innerJoin('user_roles', 'ur', 'ur.role_id = role.id')
      .where('ur.user_id = :userId', { userId })
      .getMany();
  }

  async getPermissionsForRole(roleId: string): Promise<RolePermission[]> {
    await this.findOne(roleId);
    return this.rolePermissionRepository.find({
      where: { roleId },
      relations: ['permission']
    });
  }

  async setPermissionsForRole(
    roleId: string,
    items: { permissionId: string; conditions?: PermissionCondition | null }[],
    ability?: AppAbility,
    actorId?: string
  ): Promise<void> {
    const role = await this.findOne(roleId);
    this.assertNotSystem(role, ability);
    await this.assertGrantAllowed(ability, items, { actorId, roleId });
    await this.rolePermissionRepository.manager.transaction(async (em) => {
      await em.delete(RolePermission, { roleId });
      if (items.length > 0) {
        const records = items.map(({ permissionId, conditions }) =>
          em.create(RolePermission, {
            roleId,
            permissionId,
            conditions: conditions ?? null
          })
        );
        await em.save(RolePermission, records);
      }
    });
    await this.invalidateUsersWithRole(roleId);
  }

  async assignPermissionsToRole(
    roleId: string,
    permissionIds: string[],
    conditions?: PermissionCondition,
    ability?: AppAbility,
    actorId?: string
  ): Promise<void> {
    const role = await this.findOne(roleId);
    this.assertNotSystem(role, ability);
    const items = permissionIds.map((permissionId) => ({
      permissionId,
      conditions: conditions ?? null
    }));
    await this.assertGrantAllowed(ability, items, { actorId, roleId });
    const rolePermissions = permissionIds.map((permissionId) =>
      this.rolePermissionRepository.create({
        roleId,
        permissionId,
        conditions: conditions ?? null
      })
    );
    await this.rolePermissionRepository.save(rolePermissions);
    await this.invalidateUsersWithRole(roleId);
  }

  async removePermissionFromRole(
    roleId: string,
    permissionId: string,
    ability?: AppAbility
  ): Promise<void> {
    const role = await this.findOne(roleId);
    this.assertNotSystem(role, ability);
    await this.rolePermissionRepository.delete({ roleId, permissionId });
    await this.invalidateUsersWithRole(roleId);
  }

  async findAllPermissions(): Promise<Permission[]> {
    return this.permissionRepository.find({
      relations: ['resource', 'action'],
      order: { resourceId: 'ASC', actionId: 'ASC' }
    });
  }

  async findRoleByName(name: string): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { name } });
    if (!role) {
      throw new InternalServerErrorException(
        `System role "${name}" not found. Run migrations.`
      );
    }
    return role;
  }

  private async invalidateUsersWithRole(roleId: string): Promise<void> {
    const users = await this.roleRepository.manager
      .createQueryBuilder(User, 'user')
      .select('user.id')
      .innerJoin('user.roles', 'role', 'role.id = :roleId', { roleId })
      .getMany();
    await Promise.all(
      users.map((u) => this.permissionService.invalidateUserCache(u.id))
    );
  }
}
