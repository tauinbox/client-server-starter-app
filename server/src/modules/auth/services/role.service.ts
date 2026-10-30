import {
  Injectable,
  InternalServerErrorException,
  Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { subject } from '@casl/ability';
import { Role } from '../entities/role.entity';
import { ApiError } from '../../../common/errors/api-error';
import type {
  CursorPaginatedResponseDto,
  RoleCursorQueryDto
} from '../../../common/dtos';
import { applyList } from '../../../common/utils/apply-list-query.util';
import { ROLE_LIST_COLUMNS } from '../utils/rbac-sort-columns.util';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { User } from '../../users/entities/user.entity';
import { PermissionService } from './permission.service';
import { grantableActionNames } from '@app/shared/utils/grantable-actions';
import { PermissionCondition } from '@app/shared/types';
import { ErrorKeys, ROLE_LIST_QUERY } from '@app/shared/constants';
import { SYSTEM_ABILITY } from '../casl/app-ability';
import type { AbilityOrSystem, AppAbility } from '../casl/app-ability';
import { withChanges } from '@app/shared/utils/changed-fields';
import {
  isDenyCondition,
  sameConditions,
  type GrantRefusal,
  type GrantScopeItem
} from '@app/shared/utils/grant-scope';
import {
  grantDenied,
  grantRefusalOf,
  liftRefusalOf
} from '../utils/can-grant.util';
import {
  findConditionActionError,
  findConditionFieldError,
  findConditionSupportError
} from '@app/shared/utils/permission-condition-shape';
import { AuditService } from '../../audit/audit.service';
import type { AuditLogParams } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { assertCan } from '../../../common/utils/assert-can.util';
import { isUniqueViolation } from '../../../common/utils/is-unique-violation.util';
import { assertNotSuperTarget } from '../../../common/utils/assert-not-super-target.util';
import { refuseAccess } from '../../../common/utils/refuse-access.util';
import { auditContextOf } from '../casl/ability-context';
import { MetricsService } from '../../core/metrics/metrics.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RolePermissionsChangedEvent } from '../events/role-permissions-changed.event';
import { RoleRenamedEvent } from '../events/role-renamed.event';
import { RoleDeletedEvent } from '../events/role-deleted.event';

@Injectable()
export class RoleService {
  private readonly logger = new Logger(RoleService.name);

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
  ): Promise<GrantScopeItem[]> {
    if (items.length === 0) return [];
    const permissions = await this.permissionRepository.find({
      where: items.map((i) => ({ id: i.permissionId }))
    });
    const byId = new Map(permissions.map((p) => [p.id, p]));
    return items.map((i) => {
      const p = byId.get(i.permissionId);
      if (!p) {
        throw new ApiError(
          ErrorKeys.ROLES.UNKNOWN_PERMISSION,
          `Permission ${i.permissionId} not found`
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
    ability: AbilityOrSystem,
    items: { permissionId: string; conditions?: PermissionCondition | null }[],
    context: { actorId?: string; roleId: string }
  ): Promise<void> {
    if (ability === SYSTEM_ABILITY) return;
    // Resolve before the super bypass so unknown permission ids fail with a
    // clean `UNKNOWN_PERMISSION` for every caller, not a foreign-key error.
    const resolved = await this.resolveGrantItems(items);
    if (ability.can('manage', 'all')) return;
    const refusal = grantRefusalOf(ability, resolved, {
      actorId: context.actorId,
      logger: this.logger
    });
    if (refusal) this.refuseGrant(refusal, ability, context);
  }

  /**
   * Refuse to remove deny rows unless the caller holds each restricted pair
   * without restriction. `rows` are the stored rows about to disappear; rows
   * without a deny effect are ignored.
   */
  private async assertDenyLiftAllowed(
    ability: AbilityOrSystem,
    rows: { permissionId: string; conditions: PermissionCondition | null }[],
    context: { actorId?: string; roleId: string }
  ): Promise<void> {
    if (!this.isScopeChecked(ability)) return;
    const denies = rows.filter((row) => isDenyCondition(row.conditions));
    if (denies.length === 0) return;
    const resolved = await this.resolveGrantItems(denies);
    const refusal = liftRefusalOf(ability, resolved);
    if (refusal) this.refuseGrant(refusal, ability, context);
  }

  private isScopeChecked(ability: AbilityOrSystem): ability is AppAbility {
    return ability !== SYSTEM_ABILITY && !ability.can('manage', 'all');
  }

  /**
   * Locks the role row, then refuses the lift of the stored rows that `lifted`
   * selects. A grant row goes in only under a key-share lock on its role, so
   * the rows read here stay the same until the commit: a deny that another
   * request adds cannot slip past the check. Throws `ROLES.NOT_FOUND` when the
   * role is gone.
   */
  private async lockRoleForLift(
    em: EntityManager,
    ability: AbilityOrSystem,
    roleId: string,
    actorId: string | undefined,
    lifted: (rows: RolePermission[]) => RolePermission[] = (rows) => rows
  ): Promise<void> {
    const locked = await em.findOne(Role, {
      where: { id: roleId },
      lock: { mode: 'pessimistic_write' }
    });
    if (!locked) throw this.roleNotFound();
    if (!this.isScopeChecked(ability)) return;
    const rows = await em.find(RolePermission, { where: { roleId } });
    await this.assertDenyLiftAllowed(ability, lifted(rows), {
      actorId,
      roleId
    });
  }

  private refuseGrant(
    refusal: GrantRefusal,
    ability: AppAbility,
    context: { actorId?: string; roleId: string }
  ): never {
    const { details } = refusal;
    refuseAccess(
      this.auditService,
      this.metricsService,
      {
        auditAction: AuditAction.PERMISSION_GRANT_DENIED,
        actorId: context.actorId,
        targetId: context.roleId,
        targetType: 'Role',
        details,
        context: auditContextOf(ability),
        level: 'instance',
        denied: [{ action: details.action, subject: details.subject }]
      },
      grantDenied(refusal)
    );
  }

  /** No API path assigns or removes a super role, a super caller included. */
  private refuseSuperRole(
    ability: AppAbility,
    action: 'assign' | 'unassign',
    roleId: string,
    actorId: string | undefined
  ): never {
    return refuseAccess(
      this.auditService,
      this.metricsService,
      {
        actorId,
        targetId: roleId,
        targetType: 'Role',
        details: { deniedAction: action, subject: 'Role', superRole: true },
        context: auditContextOf(ability),
        level: 'instance',
        denied: [{ action, subject: 'Role' }]
      },
      action === 'assign'
        ? new ApiError(
            ErrorKeys.ROLES.SUPER_ROLE_ASSIGN_FORBIDDEN,
            'Cannot assign super roles'
          )
        : new ApiError(
            ErrorKeys.ROLES.SUPER_ROLE_REMOVE_FORBIDDEN,
            'Cannot remove super roles'
          )
    );
  }

  /**
   * Reject a grant that would enforce nothing, whoever writes it (supers
   * included), because the admin UI would show it as access or as a limit:
   * - an allow on an action the resource does not offer is not in the
   *   permission matrix, and buildAbility drops it;
   * - a restriction on an action whose checks never read the record passes
   *   the type-level route check as a full grant;
   * - an identity-bound branch on a `create` grant denies every create;
   * - a condition on a field outside `CONDITION_FIELDS` is vetoed at run
   *   time.
   * Unknown permission ids are left to the grant check, which reports them.
   */
  private async assertGrantsApplicable(
    items: { permissionId: string; conditions?: PermissionCondition | null }[]
  ): Promise<void> {
    if (items.length === 0) return;

    const permissions = await this.permissionRepository.find({
      where: items.map((item) => ({ id: item.permissionId }))
    });
    const byId = new Map(permissions.map((p) => [p.id, p]));

    for (const item of items) {
      const permission = byId.get(item.permissionId);
      if (!permission) continue;
      const { action, resource } = permission;
      const label = `${action.name}:${resource.subject}`;

      if (
        !isDenyCondition(item.conditions ?? null) &&
        !grantableActionNames(resource).includes(action.name)
      ) {
        throw new ApiError(
          ErrorKeys.ROLES.ACTION_NOT_GRANTABLE,
          `Cannot grant ${label} - the resource does not offer this action`
        );
      }

      const supportError = findConditionSupportError(
        action.name,
        resource.conditionalActionNames,
        item.conditions
      );
      if (supportError) {
        throw new ApiError(
          ErrorKeys.ROLES.CONDITION_NOT_SUPPORTED,
          `Cannot grant ${label} - ${supportError}`
        );
      }

      const actionError = findConditionActionError(
        action.name,
        item.conditions
      );
      if (actionError) {
        throw new ApiError(
          ErrorKeys.ROLES.CONDITION_NOT_APPLICABLE,
          `Cannot grant ${label} - ${actionError}`
        );
      }

      const fieldError = findConditionFieldError(
        resource.subject,
        item.conditions
      );
      if (fieldError) {
        throw new ApiError(
          ErrorKeys.ROLES.CONDITION_FIELD_UNKNOWN,
          `Cannot grant ${label} - ${fieldError}`
        );
      }
    }
  }

  /**
   * Re-evaluate a conditional `Role` grant against the record. The route-level
   * @Authorize check is type-level only, so without this a caller scoped to
   * one role could read or change any other role.
   */
  private assertCanRole(
    ability: AbilityOrSystem,
    action: string,
    record: Partial<Role>,
    actorId?: string
  ): void {
    if (ability === SYSTEM_ABILITY) return;
    assertCan(
      ability,
      action,
      subject('Role', record),
      this.auditService,
      { actorId, targetId: record.id, targetType: 'Role' },
      this.metricsService
    );
  }

  /**
   * A super caller may change the grants of a system role, so a refusal of
   * any other caller is a refusal by privilege. `SYSTEM_ABILITY` has no
   * principal and is refused with no audit row.
   */
  private assertNotSystem(
    role: Role,
    ability: AbilityOrSystem,
    actorId?: string
  ): void {
    if (!role.isSystem) return;
    const error = () =>
      new ApiError(
        ErrorKeys.ROLES.CANNOT_MODIFY_SYSTEM,
        'Cannot modify system roles'
      );
    if (ability === SYSTEM_ABILITY) {
      throw error();
    }
    if (ability.can('manage', 'all')) return;
    refuseAccess(
      this.auditService,
      this.metricsService,
      {
        actorId,
        targetId: role.id,
        targetType: 'Role',
        details: { deniedAction: 'update', subject: 'Role', systemRole: true },
        context: auditContextOf(ability),
        level: 'instance',
        denied: [{ action: 'update', subject: 'Role' }]
      },
      error()
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
    return applyList(
      this.roleRepository.createQueryBuilder('role'),
      ROLE_LIST_QUERY,
      ROLE_LIST_COLUMNS,
      query
    );
  }

  async findOne(
    id: string,
    ability: AbilityOrSystem,
    actorId?: string
  ): Promise<Role> {
    const role = await this.loadRole(id);
    this.assertCanRole(ability, 'read', role, actorId);
    return role;
  }

  private async loadRole(id: string): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { id } });
    if (!role) throw this.roleNotFound();
    return role;
  }

  private roleNotFound(): ApiError {
    return new ApiError(ErrorKeys.ROLES.NOT_FOUND, 'Role not found');
  }

  async create(
    data: {
      name: string;
      description?: string;
    },
    ability: AbilityOrSystem,
    actorId?: string,
    audit?: (role: Role) => AuditLogParams
  ): Promise<Role> {
    this.assertCanRole(ability, 'create', data, actorId);
    const existing = await this.roleRepository.findOne({
      where: { name: data.name }
    });
    if (existing) throw this.nameExists();
    const role = this.roleRepository.create({ ...data, isSuper: false });
    return this.roleRepository.manager.transaction(async (em) => {
      const saved = await this.saveRole(em, role);
      if (audit) await this.auditService.log(audit(saved), em);
      return saved;
    });
  }

  /** `audit` gets the role as it is before the write. */
  async update(
    id: string,
    data: { name?: string; description?: string },
    ability: AbilityOrSystem,
    actorId?: string,
    audit?: (before: Role) => AuditLogParams
  ): Promise<Role> {
    const role = await this.loadRole(id);
    // The record after the write is checked too: else a grant scoped by a
    // writable field lets the caller move a role out of its own scope.
    for (const record of [role, withChanges(role, data)]) {
      this.assertCanRole(ability, 'update', record, actorId);
    }
    if (role.isSystem) {
      throw new ApiError(
        ErrorKeys.ROLES.CANNOT_MODIFY_SYSTEM,
        'Cannot modify system roles'
      );
    }
    if (data.name) {
      const existing = await this.roleRepository.findOne({
        where: { name: data.name }
      });
      if (existing && existing.id !== id) throw this.nameExists();
    }
    const oldName = role.name;
    const auditRow = audit?.({ ...role });
    Object.assign(role, data);
    if (role.name === oldName) {
      return this.writeAudited(
        this.roleRepository.manager,
        (em) => this.saveRole(em, role),
        auditRow
      );
    }

    const saved = await this.writeWithRoleEvent(
      (em) => this.saveRole(em, role),
      RoleRenamedEvent.name,
      (em, committed) =>
        new RoleRenamedEvent(oldName, role.name, em, committed),
      auditRow
    );
    // Holders have the old name in the cached role names that flag rules use.
    await this.invalidateUsersWithRole(id);
    return saved;
  }

  async delete(
    id: string,
    ability: AbilityOrSystem,
    actorId?: string,
    audit?: (role: Role) => AuditLogParams
  ): Promise<void> {
    const role = await this.loadRole(id);
    this.assertCanRole(ability, 'delete', role, actorId);
    if (role.isSystem) {
      throw new ApiError(
        ErrorKeys.ROLES.CANNOT_DELETE_SYSTEM,
        'Cannot delete system roles'
      );
    }
    // Invalidate after the commit, or a holder read in between re-caches the
    // deleted grants for the TTL. Holders are read before the delete cascades.
    let holderIds: string[] = [];
    const auditRow = audit?.(role);
    await this.writeWithRoleEvent(
      async (em) => {
        await this.lockRoleForLift(em, ability, id, actorId);
        holderIds = await this.findHolderIds(em, id);
        await em.delete(Role, { id });
      },
      RoleDeletedEvent.name,
      (em, committed) => new RoleDeletedEvent(role.name, em, committed),
      auditRow
    );
    await this.invalidateHolders(holderIds);
  }

  private nameExists(): ApiError {
    return new ApiError(
      ErrorKeys.ROLES.NAME_EXISTS,
      'Role with this name already exists'
    );
  }

  // The read check of the name runs before the transaction, so a concurrent
  // request can take the name between them; the unique index then refuses it.
  private async saveRole(em: EntityManager, role: Role): Promise<Role> {
    try {
      return await em.save(Role, role);
    } catch (error) {
      throw isUniqueViolation(error) ? this.nameExists() : error;
    }
  }

  /**
   * Runs `write` and the audit row of the change in one transaction, so a
   * failed row rolls the write back.
   */
  private writeAudited<T>(
    manager: EntityManager,
    write: (em: EntityManager) => Promise<T>,
    audit?: AuditLogParams
  ): Promise<T> {
    return manager.transaction(async (em) => {
      const written = await write(em);
      if (audit) await this.auditService.log(audit, em);
      return written;
    });
  }

  /**
   * Runs `write`, its audit row and the listeners of the event in one
   * transaction, so a failed row or listener rolls the write back. The event
   * gets a promise that resolves after the commit.
   */
  private async writeWithRoleEvent<T>(
    write: (em: EntityManager) => Promise<T>,
    eventName: string,
    createEvent: (em: EntityManager, committed: Promise<void>) => object,
    audit?: AuditLogParams
  ): Promise<T> {
    let markCommitted: () => void = () => undefined;
    const committed = new Promise<void>((resolve) => {
      markCommitted = resolve;
    });
    const result = await this.writeAudited(
      this.roleRepository.manager,
      async (em) => {
        const written = await write(em);
        await this.eventEmitter.emitAsync(
          eventName,
          createEvent(em, committed)
        );
        return written;
      },
      audit
    );
    markCommitted();
    return result;
  }

  /**
   * Membership writes go straight to `user_roles`, which accepts a soft-deleted
   * user and answers an unknown one with a foreign-key error. Resolving the
   * target up front turns both into `USERS.NOT_FOUND` and guarantees the
   * instance-level check below always has a row to run against. Soft-deleted
   * users are not mutable through the admin API (same rule as
   * UsersService.update) - restore the account first.
   */
  private async loadRoleAssignmentTarget(userId: string): Promise<User> {
    const targetUser = await this.roleRepository.manager.findOne(User, {
      where: { id: userId },
      relations: { roles: true }
    });
    if (!targetUser) {
      throw new ApiError(
        ErrorKeys.USERS.NOT_FOUND,
        `User with ID ${userId} not found`
      );
    }
    return targetUser;
  }

  /**
   * No API path assigns a super role: every route passes the ability of the
   * caller. `SYSTEM_ABILITY` may, because seeders and tests need it.
   */
  async assignRoleToUser(
    userId: string,
    roleId: string,
    ability: AbilityOrSystem,
    actorId?: string,
    audit?: AuditLogParams
  ): Promise<void> {
    const targetUser = await this.loadRoleAssignmentTarget(userId);
    // The role id comes from the body, so a missing role is not a missing
    // target resource.
    const role = await this.roleRepository.findOne({ where: { id: roleId } });
    if (!role) {
      throw new ApiError(ErrorKeys.ROLES.UNKNOWN_ROLE, 'Role not found');
    }

    if (ability !== SYSTEM_ABILITY) {
      if (role.isSuper) {
        this.refuseSuperRole(ability, 'assign', roleId, actorId);
      }
      assertCan(
        ability,
        'update',
        subject('User', targetUser),
        this.auditService,
        { actorId, targetId: userId, targetType: 'User' },
        this.metricsService
      );
      // Any role change ends every session of the target, so a delegated
      // actor could keep a super account signed out with it.
      assertNotSuperTarget(
        ability,
        'update',
        targetUser,
        this.auditService,
        actorId,
        this.metricsService
      );
      assertCan(
        ability,
        'assign',
        subject('Role', role),
        this.auditService,
        { actorId, targetId: roleId, targetType: 'Role' },
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

    await this.writeAudited(
      this.roleRepository.manager,
      (em) =>
        em.createQueryBuilder().relation(User, 'roles').of(userId).add(roleId),
      audit
    );
    await this.permissionService.invalidateUserCache(userId);
  }

  async removeRoleFromUser(
    userId: string,
    roleId: string,
    ability: AbilityOrSystem,
    actorId?: string,
    audit?: AuditLogParams
  ): Promise<void> {
    const targetUser = await this.loadRoleAssignmentTarget(userId);
    const role = await this.loadRole(roleId);

    if (ability !== SYSTEM_ABILITY) {
      if (role.isSuper) {
        this.refuseSuperRole(ability, 'unassign', roleId, actorId);
      }
      assertCan(
        ability,
        'update',
        subject('User', targetUser),
        this.auditService,
        { actorId, targetId: userId, targetType: 'User' },
        this.metricsService
      );
      // Any role change ends every session of the target, so a delegated
      // actor could keep a super account signed out with it.
      assertNotSuperTarget(
        ability,
        'update',
        targetUser,
        this.auditService,
        actorId,
        this.metricsService
      );
      assertCan(
        ability,
        'assign',
        subject('Role', role),
        this.auditService,
        { actorId, targetId: roleId, targetType: 'Role' },
        this.metricsService
      );
    }

    // The delete is the existence check, so a concurrent removal cannot
    // pass a separate read and still audit and end the sessions twice.
    await this.writeAudited(
      this.roleRepository.manager,
      async (em) => {
        await this.lockRoleForLift(em, ability, roleId, actorId);
        const { affected } = await em
          .createQueryBuilder()
          .delete()
          .from('user_roles')
          .where('user_id = :userId AND role_id = :roleId', { userId, roleId })
          .execute();
        if (!affected) {
          throw new ApiError(
            ErrorKeys.ROLES.ROLE_NOT_ASSIGNED,
            'The user does not hold this role'
          );
        }
      },
      audit
    );
    await this.permissionService.invalidateUserCache(userId);
  }

  async getPermissionsForRole(
    roleId: string,
    ability: AbilityOrSystem,
    actorId?: string
  ): Promise<RolePermission[]> {
    await this.findOne(roleId, ability, actorId);
    return this.rolePermissionRepository.find({
      where: { roleId },
      relations: { permission: true }
    });
  }

  async setPermissionsForRole(
    roleId: string,
    items: { permissionId: string; conditions?: PermissionCondition | null }[],
    ability: AbilityOrSystem,
    actorId?: string,
    audit?: AuditLogParams
  ): Promise<void> {
    const role = await this.loadRole(roleId);
    this.assertCanRole(ability, 'update', role, actorId);
    this.assertNotSystem(role, ability, actorId);
    await this.assertGrantsApplicable(items);
    await this.assertGrantAllowed(ability, items, { actorId, roleId });
    await this.writeAudited(
      this.rolePermissionRepository.manager,
      async (em) => {
        // The lock also makes two replaces of one role run one after the
        // other: else both delete the old rows, and the second insert breaks
        // the unique index of the grant. A deny row survives a replace only
        // when it is sent back unchanged.
        await this.lockRoleForLift(em, ability, roleId, actorId, (rows) =>
          rows.filter(
            (row) =>
              !items.some(
                (item) =>
                  item.permissionId === row.permissionId &&
                  sameConditions(item.conditions, row.conditions)
              )
          )
        );
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
      },
      audit
    );
    await this.invalidateUsersWithRole(roleId);
  }

  async assignPermissionsToRole(
    roleId: string,
    permissionIds: string[],
    conditions: PermissionCondition | undefined,
    ability: AbilityOrSystem,
    actorId?: string,
    audit?: AuditLogParams
  ): Promise<void> {
    const role = await this.loadRole(roleId);
    this.assertCanRole(ability, 'update', role, actorId);
    this.assertNotSystem(role, ability, actorId);
    const items = permissionIds.map((permissionId) => ({
      permissionId,
      conditions: conditions ?? null
    }));
    await this.assertGrantsApplicable(items);
    await this.assertGrantAllowed(ability, items, { actorId, roleId });
    const rolePermissions = permissionIds.map((permissionId) =>
      this.rolePermissionRepository.create({
        roleId,
        permissionId,
        conditions: conditions ?? null
      })
    );
    await this.writeAudited(
      this.rolePermissionRepository.manager,
      (em) => em.save(RolePermission, rolePermissions),
      audit
    );
    await this.invalidateUsersWithRole(roleId);
  }

  async removePermissionFromRole(
    roleId: string,
    permissionId: string,
    ability: AbilityOrSystem,
    actorId?: string,
    audit?: AuditLogParams
  ): Promise<void> {
    const role = await this.loadRole(roleId);
    this.assertCanRole(ability, 'update', role, actorId);
    this.assertNotSystem(role, ability, actorId);
    await this.writeAudited(
      this.rolePermissionRepository.manager,
      async (em) => {
        await this.lockRoleForLift(em, ability, roleId, actorId, (rows) =>
          rows.filter((row) => row.permissionId === permissionId)
        );
        const { affected } = await em.delete(RolePermission, {
          roleId,
          permissionId
        });
        if (!affected) {
          throw new ApiError(
            ErrorKeys.ROLES.PERMISSION_NOT_ASSIGNED,
            'The role does not hold this permission'
          );
        }
      },
      audit
    );
    await this.invalidateUsersWithRole(roleId);
  }

  async findAllPermissions(): Promise<Permission[]> {
    return this.permissionRepository.find({
      relations: { resource: true, action: true },
      order: { resourceId: 'ASC', actionId: 'ASC' }
    });
  }

  async findRoleByName(name: string): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { name } });
    if (!role) {
      // eslint-disable-next-line no-restricted-syntax -- a deployment error (500): the migrations were not run
      throw new InternalServerErrorException(
        `System role "${name}" not found. Run migrations.`
      );
    }
    return role;
  }

  private async invalidateUsersWithRole(roleId: string): Promise<void> {
    await this.invalidateHolders(
      await this.findHolderIds(this.roleRepository.manager, roleId)
    );
  }

  private async findHolderIds(
    em: EntityManager,
    roleId: string
  ): Promise<string[]> {
    const users = await em
      .createQueryBuilder(User, 'user')
      .select('user.id')
      .innerJoin('user.roles', 'role', 'role.id = :roleId', { roleId })
      .getMany();
    return users.map((u) => u.id);
  }

  private async invalidateHolders(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
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
