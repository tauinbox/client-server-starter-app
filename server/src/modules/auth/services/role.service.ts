import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { subject } from '@casl/ability';
import { Role } from '../entities/role.entity';
import { CursorPaginatedResponseDto } from '../../../common/dtos';
import type { RoleCursorQueryDto } from '../../../common/dtos';
import { applyKeysetPagination } from '../../../common/utils/apply-keyset-pagination.util';
import { ROLE_SORT_COLUMN_MAP } from '../utils/rbac-sort-columns.util';
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
import {
  findConditionActionError,
  findIdentityBoundBranch
} from '@app/shared/utils/permission-condition-shape';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { assertCan } from '../../../common/utils/assert-can.util';
import { MetricsService } from '../../core/metrics/metrics.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RolePermissionsChangedEvent } from '../events/role-permissions-changed.event';

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
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService,
    private readonly eventEmitter: EventEmitter2
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
    // Resolve before the super bypass so unknown permission ids fail with a
    // clean 400 for every caller instead of an opaque FK-violation 409.
    const resolved = await this.resolveGrantItems(items);
    if (ability.can('manage', 'all')) return;
    try {
      assertCanGrantPermissions(ability, resolved);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === 403) {
        const body = err.getResponse();
        const details =
          typeof body === 'object' && body !== null
            ? ((body as { details?: Record<string, unknown> }).details ?? {
                body
              })
            : { message: String(body) };
        this.auditService.logFireAndForget({
          action: AuditAction.PERMISSION_GRANT_DENIED,
          actorId: context.actorId ?? null,
          targetId: context.roleId,
          targetType: 'Role',
          details
        });
        const rawAction =
          typeof details === 'object' && 'action' in details
            ? (details as { action?: unknown }).action
            : undefined;
        const rawSubject =
          typeof details === 'object' && 'subject' in details
            ? (details as { subject?: unknown }).subject
            : undefined;
        const deniedAction =
          typeof rawAction === 'string' ? rawAction : 'grant';
        const deniedSubject =
          typeof rawSubject === 'string' ? rawSubject : 'Permission';
        this.metricsService.recordPermissionDenied(
          'instance',
          deniedAction,
          deniedSubject
        );
      }
      throw err;
    }
  }

  /**
   * Reject a condition branch the granted action can never satisfy, whoever
   * writes it (supers included) - an identity-bound branch on a `create` grant
   * denies every create instead of restricting it, so it reads as a
   * restriction in the admin UI while enforcing nothing. Only items that carry
   * such a branch are resolved, so the common case costs no query. Unknown
   * permission ids are left to the grant check, which reports them.
   */
  private async assertConditionsApplicable(
    items: { permissionId: string; conditions?: PermissionCondition | null }[]
  ): Promise<void> {
    const identityBound = items.filter(
      (item) => findIdentityBoundBranch(item.conditions) !== null
    );
    if (identityBound.length === 0) return;

    const permissions = await this.permissionRepository.find({
      where: identityBound.map((item) => ({ id: item.permissionId }))
    });
    const byId = new Map(permissions.map((p) => [p.id, p]));

    for (const item of identityBound) {
      const permission = byId.get(item.permissionId);
      if (!permission) continue;
      const error = findConditionActionError(
        permission.action.name,
        item.conditions
      );
      if (error) {
        throw new HttpException(
          {
            message: `Cannot grant ${permission.action.name}:${permission.resource.subject} - ${error}`,
            errorKey: ErrorKeys.ROLES.CONDITION_NOT_APPLICABLE
          },
          HttpStatus.BAD_REQUEST
        );
      }
    }
  }

  /**
   * Re-evaluate a conditional `update:Role` grant against the loaded row.
   * The route-level @Authorize check is type-level only, so without this a
   * caller scoped to one role could mutate any other role's permission set.
   */
  private assertCanUpdateRole(
    role: Role,
    ability?: AppAbility,
    actorId?: string
  ): void {
    if (!ability) return;
    assertCan(
      ability,
      'update',
      subject('Role', role),
      this.auditService,
      { actorId, targetId: role.id, targetType: 'Role' },
      this.metricsService
    );
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

  /**
   * Cursor-paginated roles for the admin list page. The unpaginated findAll
   * above stays: it backs the assign-role picker and the rule editor, which
   * need every option in one shot.
   */
  async findCursorPaginated(
    query: RoleCursorQueryDto
  ): Promise<CursorPaginatedResponseDto<Role>> {
    const { cursor, limit, sortBy, sortOrder } = query;
    const { data, nextCursor } = await applyKeysetPagination(
      this.roleRepository.createQueryBuilder('role'),
      {
        cursor,
        limit,
        sortBy,
        sortOrder,
        sortColumnMap: ROLE_SORT_COLUMN_MAP,
        idColumn: 'role.id'
      }
    );
    return new CursorPaginatedResponseDto(data, nextCursor, limit);
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

  /**
   * Membership writes go straight to `user_roles`, which accepts a soft-deleted
   * user and answers an unknown one with an opaque FK-violation 409. Resolving
   * the target up front turns both into a 404 and guarantees the instance-level
   * check below always has a row to run against. Soft-deleted users are not
   * mutable through the admin API (same rule as UsersService.update) - restore
   * the account first.
   */
  private async loadRoleAssignmentTarget(userId: string): Promise<User> {
    const targetUser = await this.roleRepository.manager.findOne(User, {
      where: { id: userId }
    });
    if (!targetUser) {
      throw new HttpException(
        {
          message: `User with ID ${userId} not found`,
          errorKey: ErrorKeys.USERS.NOT_FOUND
        },
        HttpStatus.NOT_FOUND
      );
    }
    return targetUser;
  }

  async assignRoleToUser(
    userId: string,
    roleId: string,
    ability?: AppAbility,
    actorId?: string
  ): Promise<void> {
    const targetUser = await this.loadRoleAssignmentTarget(userId);
    const role = await this.findOne(roleId);

    if (ability) {
      if (role.isSuper) {
        this.metricsService.recordPermissionDenied(
          'instance',
          'assign',
          'Role'
        );
        throw new ForbiddenException('Cannot assign super roles');
      }
      assertCan(
        ability,
        'update',
        subject('User', targetUser),
        this.auditService,
        { actorId, targetId: userId, targetType: 'User' },
        this.metricsService
      );

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
    ability?: AppAbility,
    actorId?: string
  ): Promise<void> {
    const targetUser = await this.loadRoleAssignmentTarget(userId);
    const role = await this.findOne(roleId);

    if (ability) {
      if (role.isSuper) {
        this.metricsService.recordPermissionDenied(
          'instance',
          'unassign',
          'Role'
        );
        throw new ForbiddenException('Cannot remove super roles');
      }
      assertCan(
        ability,
        'update',
        subject('User', targetUser),
        this.auditService,
        { actorId, targetId: userId, targetType: 'User' },
        this.metricsService
      );
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
    this.assertCanUpdateRole(role, ability, actorId);
    this.assertNotSystem(role, ability);
    await this.assertConditionsApplicable(items);
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
    this.assertCanUpdateRole(role, ability, actorId);
    this.assertNotSystem(role, ability);
    const items = permissionIds.map((permissionId) => ({
      permissionId,
      conditions: conditions ?? null
    }));
    await this.assertConditionsApplicable(items);
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
    ability?: AppAbility,
    actorId?: string
  ): Promise<void> {
    const role = await this.findOne(roleId);
    this.assertCanUpdateRole(role, ability, actorId);
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
    if (users.length === 0) return;
    const userIds = users.map((u) => u.id);
    await Promise.all(
      userIds.map((id) => this.permissionService.invalidateUserCache(id))
    );
    // Notify every connected holder so their client-side abilities refresh
    // without a reload. A separate event from UserRoleChangedEvent: this must
    // NOT revoke tokens — abilities are re-derived from the DB per request.
    this.eventEmitter.emit(
      RolePermissionsChangedEvent.name,
      new RolePermissionsChangedEvent(userIds)
    );
  }
}
