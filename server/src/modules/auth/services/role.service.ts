import { randomUUID } from 'node:crypto';
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
import { lockUserWithRoles } from '../../users/utils/lock-user';
import { addUserRole, findUserWithRoles } from '../../users/utils/user-roles';
import { userNotFound } from '../../users/utils/user-not-found';
import { PermissionService } from './permission.service';
import { grantableActionNames } from '@app/shared/utils/grantable-actions';
import { PermissionCondition } from '@app/shared/types';
import {
  ErrorKeys,
  ROLE_LIST_QUERY,
  SYSTEM_ROLES
} from '@app/shared/constants';
import { SYSTEM_ABILITY } from '../casl/app-ability';
import type { AbilityOrSystem, AppAbility } from '../casl/app-ability';
import { withChanges } from '@app/shared/utils/changed-fields';
import {
  isDenyCondition,
  isWithinUserRoleCeiling,
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
import { isUniqueViolation } from '../../../common/utils/is-unique-violation.util';
import { keyedUpdate } from '../../../common/utils/keyed-update.util';
import { AccessRefusalService } from '../../audit/access-refusal.service';
import { auditContextOf } from '../casl/ability-context';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SettingsChangeLogService,
  writeSettings
} from '../../core/settings-change-log/settings-change-log.service';
import type { SettingsWrite } from '../../core/settings-change-log/settings-change-log.service';
import { RoleRenamedEvent } from '../events/role-renamed.event';
import { RoleDeletedEvent } from '../events/role-deleted.event';

export interface RoleWriteOptions<A = AuditLogParams> {
  ability: AbilityOrSystem;
  actorId?: string;
  audit?: A;
}

type GrantItem = {
  permissionId: string;
  conditions?: PermissionCondition | null;
};

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
    private readonly accessRefusals: AccessRefusalService,
    private readonly eventEmitter: EventEmitter2,
    private readonly settingsChangeLog: SettingsChangeLogService
  ) {}

  private async resolveGrantItems(
    items: GrantItem[]
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
    items: GrantItem[],
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
   * Every change of a stored role, of its grants or of its holders takes this
   * lock before its instance checks, so a check judges the row that the write
   * changes.
   */
  private lockRole(em: EntityManager, id: string): Promise<Role | null> {
    return em.findOne(Role, {
      where: { id },
      lock: { mode: 'pessimistic_write' }
    });
  }

  /**
   * Locks the role row, runs `check` on it, then refuses the lift of the
   * stored rows that `lifted` selects. A grant row goes in only under a
   * key-share lock on its role, so the rows read here stay the same until the
   * commit: a deny that another request adds cannot slip past the check.
   * Throws `ROLES.NOT_FOUND` when the role is gone. Returns the locked row.
   */
  private async lockRoleForLift(
    em: EntityManager,
    ability: AbilityOrSystem,
    {
      roleId,
      actorId,
      check,
      lifted = (rows) => rows
    }: {
      roleId: string;
      actorId?: string;
      check: (locked: Role) => void;
      lifted?: (rows: RolePermission[]) => RolePermission[];
    }
  ): Promise<Role> {
    const locked = await this.lockRole(em, roleId);

    if (!locked) throw this.roleNotFound();

    check(locked);

    if (!this.isScopeChecked(ability)) return locked;

    const rows = await em.find(RolePermission, { where: { roleId } });

    await this.assertDenyLiftAllowed(ability, lifted(rows), {
      actorId,
      roleId
    });

    return locked;
  }

  private refuseGrant(
    refusal: GrantRefusal,
    ability: AppAbility,
    context: { actorId?: string; roleId: string }
  ): never {
    const { details } = refusal;

    this.accessRefusals.refuse(
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
    {
      action,
      roleId,
      actorId
    }: { action: 'assign' | 'unassign'; roleId: string; actorId?: string }
  ): never {
    return this.accessRefusals.refuse(
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
   *   time;
   * - an allow of the `user` role outside `USER_ROLE_PERMISSION_CEILING` is
   *   dropped when the ability is built.
   * Unknown permission ids are left to the grant check, which reports them.
   */
  private async assertGrantsApplicable(
    role: Role,
    items: GrantItem[]
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

      if (
        role.name === SYSTEM_ROLES.USER &&
        !isWithinUserRoleCeiling({
          resource: resource.name,
          action: action.name,
          conditions: item.conditions
        })
      ) {
        throw new ApiError(
          ErrorKeys.ROLES.GRANT_OUTSIDE_USER_ROLE,
          `Cannot grant ${label} to the ${SYSTEM_ROLES.USER} role - it holds only the self-service permissions`
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
    {
      action,
      record,
      actorId
    }: { action: string; record: Partial<Role>; actorId?: string }
  ): void {
    if (ability === SYSTEM_ABILITY) return;

    this.accessRefusals.assertCan(ability, {
      action,
      subject: subject('Role', record),
      actorId,
      targetId: record.id,
      targetType: 'Role'
    });
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

    this.accessRefusals.refuse(
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

  private assertCanEditRole(
    ability: AbilityOrSystem,
    role: Role,
    {
      data,
      actorId
    }: { data: { name?: string; description?: string }; actorId?: string }
  ): void {
    // The record after the write is checked too: else a grant scoped by a
    // writable field lets the caller move a role out of its own scope.
    for (const record of [role, withChanges(role, data)]) {
      this.assertCanRole(ability, { action: 'update', record, actorId });
    }

    if (role.isSystem) {
      throw new ApiError(
        ErrorKeys.ROLES.CANNOT_MODIFY_SYSTEM,
        'Cannot modify system roles'
      );
    }
  }

  private assertCanDeleteRole(
    ability: AbilityOrSystem,
    role: Role,
    actorId?: string
  ): void {
    this.assertCanRole(ability, { action: 'delete', record: role, actorId });

    if (role.isSystem) {
      throw new ApiError(
        ErrorKeys.ROLES.CANNOT_DELETE_SYSTEM,
        'Cannot delete system roles'
      );
    }
  }

  private assertCanChangeGrants(
    ability: AbilityOrSystem,
    role: Role,
    actorId?: string
  ): void {
    this.assertCanRole(ability, { action: 'update', record: role, actorId });
    this.assertNotSystem(role, ability, actorId);
  }

  private assertCanChangeHolder(
    ability: AbilityOrSystem,
    {
      action,
      user,
      role,
      actorId
    }: {
      action: 'assign' | 'unassign';
      user: User;
      role: Role;
      actorId?: string;
    }
  ): void {
    if (ability === SYSTEM_ABILITY) return;

    if (role.isSuper) {
      this.refuseSuperRole(ability, { action, roleId: role.id, actorId });
    }

    this.accessRefusals.assertCan(ability, {
      action: 'update',
      subject: subject('User', user),
      actorId,
      targetId: user.id,
      targetType: 'User'
    });
    // Any role change ends every session of the target, so a delegated
    // actor could keep a super account signed out with it.
    this.accessRefusals.assertNotSuperTarget(ability, {
      action: 'update',
      target: user,
      actorId
    });
    this.accessRefusals.assertCan(ability, {
      action: 'assign',
      subject: subject('Role', role),
      actorId,
      targetId: role.id,
      targetType: 'Role'
    });
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
      { spec: ROLE_LIST_QUERY, columns: ROLE_LIST_COLUMNS },
      query
    );
  }

  async findOne(
    id: string,
    ability: AbilityOrSystem,
    actorId?: string
  ): Promise<Role> {
    const role = await this.loadRole(id);

    this.assertCanRole(ability, { action: 'read', record: role, actorId });

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

  // race-checked: no stored row exists before the insert
  async create(
    data: {
      name: string;
      description?: string;
    },
    {
      ability,
      actorId,
      audit
    }: RoleWriteOptions<(role: Role) => AuditLogParams>
  ): Promise<Role> {
    this.assertCanRole(ability, { action: 'create', record: data, actorId });
    const existing = await this.roleRepository.findOne({
      where: { name: data.name }
    });

    if (existing) throw this.nameExists();

    // The id is set here, so the audit row that is committed first names it.
    const role = this.roleRepository.create({
      ...data,
      id: randomUUID(),
      isSuper: false
    });

    return this.writeSettings(async (em, recordAudit) => {
      const saved = await this.saveRole(em, role);

      if (audit) recordAudit(audit(saved));

      return saved;
    }, audit?.(role));
  }

  /** `audit` gets the locked role as it is before the write. */
  async update(
    id: string,
    data: { name?: string; description?: string },
    {
      ability,
      actorId,
      audit
    }: RoleWriteOptions<(before: Role) => AuditLogParams>
  ): Promise<Role> {
    const role = await this.loadRole(id);
    const check = (record: Role) =>
      this.assertCanEditRole(ability, record, { data, actorId });

    // Checked here to answer early, and again on the locked row.
    check(role);

    if (data.name) {
      const existing = await this.roleRepository.findOne({
        where: { name: data.name }
      });

      if (existing && existing.id !== id) throw this.nameExists();
    }

    // The old name comes from the locked row: a rename that committed after
    // the read above changed it, and the listeners rewrite by that name.
    return this.writeWithRoleEvent(
      async (em) => {
        const before = await this.lockRole(em, id);

        if (!before) throw this.roleNotFound();

        check(before);
        const written = await this.updateRole(em, id, data);

        return {
          result: written,
          audit: audit?.({ ...before }),
          event:
            written.name !== before.name
              ? new RoleRenamedEvent(before.name, written.name, em)
              : undefined
        };
      },
      audit?.({ ...role })
    );
  }

  async delete(
    id: string,
    {
      ability,
      actorId,
      audit
    }: RoleWriteOptions<(role: Role) => AuditLogParams>
  ): Promise<void> {
    const role = await this.loadRole(id);
    const check = (record: Role) =>
      this.assertCanDeleteRole(ability, record, actorId);

    // Checked here to answer early, and again on the locked row.
    check(role);
    // The membership rows stay until the apply of the change log has read
    // them as the holders whose caches it drops.
    await this.writeWithRoleEvent(async (em) => {
      const locked = await this.lockRoleForLift(em, ability, {
        roleId: id,
        actorId,
        check
      });

      await em.delete(Role, { id });

      return {
        result: undefined,
        audit: audit?.(locked),
        event: new RoleDeletedEvent(locked.name, em)
      };
    }, audit?.(role));
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

  /** Keyed on the row, so an edit that loses to a delete answers not found. */
  private async updateRole(
    em: EntityManager,
    id: string,
    data: { name?: string; description?: string }
  ): Promise<Role> {
    let found: boolean;

    try {
      found = await keyedUpdate(em, Role, { where: { id }, changes: data });
    } catch (error) {
      throw isUniqueViolation(error) ? this.nameExists() : error;
    }

    if (!found) throw this.roleNotFound();

    return em.findOneByOrFail(Role, { id });
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
   * Runs `write` in a transaction that first takes the settings log lock, then
   * applies the change log after the commit, so the caller answers only when
   * the caches of its pool no longer hold the old settings. `audit` is the
   * row that is committed before the write (`writeSettings`).
   */
  private writeSettings<T>(
    write: SettingsWrite<T>,
    audit?: AuditLogParams
  ): Promise<T> {
    return writeSettings(
      this.roleRepository.manager,
      {
        log: this.settingsChangeLog,
        audit: audit && { trail: this.auditService, draft: audit }
      },
      write
    );
  }

  /**
   * Runs `write`, then the listeners of the event, in one settings write, so a
   * failed listener rolls the write back. `write` builds the event and the
   * final audit row from the rows it locked; `draft` is built from the rows
   * read before the transaction.
   */
  private writeWithRoleEvent<T>(
    write: (em: EntityManager) => Promise<{
      result: T;
      audit?: AuditLogParams;
      event?: RoleRenamedEvent | RoleDeletedEvent;
    }>,
    draft?: AuditLogParams
  ): Promise<T> {
    return this.writeSettings(async (em, recordAudit) => {
      const change = await write(em);

      if (change.event) {
        const name =
          change.event instanceof RoleRenamedEvent
            ? RoleRenamedEvent.name
            : RoleDeletedEvent.name;

        await this.eventEmitter.emitAsync(name, change.event);
      }

      if (change.audit) recordAudit(change.audit);

      return change.result;
    }, draft);
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
    const targetUser = await findUserWithRoles(this.roleRepository.manager, {
      where: { id: userId }
    });

    if (!targetUser) throw userNotFound(userId);

    return targetUser;
  }

  /** The user is locked before the role, on every path that locks both. */
  private async lockRoleAssignmentTarget(
    em: EntityManager,
    userId: string
  ): Promise<User> {
    const targetUser = await lockUserWithRoles(em, { id: userId });

    if (!targetUser) throw userNotFound(userId);

    return targetUser;
  }

  // The role id comes from the body, so a missing role is not a missing
  // target resource.
  private unknownRole(): ApiError {
    return new ApiError(ErrorKeys.ROLES.UNKNOWN_ROLE, 'Role not found');
  }

  /**
   * The checks of `assertCanChangeHolder`, then the rule against indirect
   * escalation: the caller must hold every permission that the role carries.
   */
  private async assertCanAssignRole(
    em: EntityManager,
    ability: AbilityOrSystem,
    { user, role, actorId }: { user: User; role: Role; actorId?: string }
  ): Promise<void> {
    if (ability === SYSTEM_ABILITY) return;

    this.assertCanChangeHolder(ability, {
      action: 'assign',
      user,
      role,
      actorId
    });
    const rolePermissions = await em.find(RolePermission, {
      where: { roleId: role.id }
    });
    const grantItems = rolePermissions.map((rp) => ({
      permissionId: rp.permissionId,
      conditions: rp.conditions ?? null
    }));

    await this.assertGrantAllowed(ability, grantItems, {
      actorId,
      roleId: role.id
    });
  }

  /**
   * No API path assigns a super role: every route passes the ability of the
   * caller. `SYSTEM_ABILITY` may, because seeders and tests need it.
   */
  async assignRoleToUser(
    userId: string,
    roleId: string,
    { ability, actorId, audit }: RoleWriteOptions
  ): Promise<void> {
    const targetUser = await this.loadRoleAssignmentTarget(userId);
    const role = await this.roleRepository.findOne({ where: { id: roleId } });

    if (!role) throw this.unknownRole();

    // Checked here to answer early, and again on the locked rows.
    await this.assertCanAssignRole(this.roleRepository.manager, ability, {
      user: targetUser,
      role,
      actorId
    });

    await this.writeAudited(
      this.roleRepository.manager,
      async (em) => {
        const user = await this.lockRoleAssignmentTarget(em, userId);
        const locked = await this.lockRole(em, roleId);

        if (!locked) throw this.unknownRole();

        await this.assertCanAssignRole(em, ability, {
          user,
          role: locked,
          actorId
        });
        await addUserRole(em, { userId, roleId });
      },
      audit
    );
    await this.permissionService.invalidateUserCache(userId);
  }

  async removeRoleFromUser(
    userId: string,
    roleId: string,
    { ability, actorId, audit }: RoleWriteOptions
  ): Promise<void> {
    const targetUser = await this.loadRoleAssignmentTarget(userId);
    const role = await this.loadRole(roleId);
    const check = (user: User, record: Role) =>
      this.assertCanChangeHolder(ability, {
        action: 'unassign',
        user,
        role: record,
        actorId
      });

    // Checked here to answer early, and again on the locked rows.
    check(targetUser, role);

    // The delete is the existence check, so a concurrent removal cannot
    // pass a separate read and still audit and end the sessions twice.
    await this.writeAudited(
      this.roleRepository.manager,
      async (em) => {
        const user = await this.lockRoleAssignmentTarget(em, userId);

        await this.lockRoleForLift(em, ability, {
          roleId,
          actorId,
          check: (locked) => check(user, locked)
        });
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
    items: GrantItem[],
    { ability, actorId, audit }: RoleWriteOptions
  ): Promise<void> {
    const check = (role: Role) =>
      this.assertCanChangeGrants(ability, role, actorId);

    const role = await this.loadRole(roleId);

    // Checked here to answer early, and again on the locked row.
    check(role);
    await this.assertGrantsApplicable(role, items);
    await this.assertGrantAllowed(ability, items, { actorId, roleId });
    await this.writeSettings(async (em) => {
      // The lock also makes two replaces of one role run one after the
      // other: else both delete the old rows, and the second insert breaks
      // the unique index of the grant. A deny row survives a replace only
      // when it is sent back unchanged.
      await this.lockRoleForLift(em, ability, {
        roleId,
        actorId,
        check,
        lifted: (rows) =>
          rows.filter(
            (row) =>
              !items.some(
                (item) =>
                  item.permissionId === row.permissionId &&
                  sameConditions(item.conditions, row.conditions)
              )
          )
      });
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
    }, audit);
  }

  async assignPermissionsToRole(
    roleId: string,
    {
      permissionIds,
      conditions
    }: { permissionIds: string[]; conditions?: PermissionCondition },
    { ability, actorId, audit }: RoleWriteOptions
  ): Promise<void> {
    const check = (role: Role) =>
      this.assertCanChangeGrants(ability, role, actorId);

    const role = await this.loadRole(roleId);

    // Checked here to answer early, and again on the locked row.
    check(role);
    const items = permissionIds.map((permissionId) => ({
      permissionId,
      conditions: conditions ?? null
    }));

    await this.assertGrantsApplicable(role, items);
    await this.assertGrantAllowed(ability, items, { actorId, roleId });
    const rolePermissions = permissionIds.map((permissionId) =>
      this.rolePermissionRepository.create({
        roleId,
        permissionId,
        conditions: conditions ?? null
      })
    );

    await this.writeSettings(async (em) => {
      // An add lifts no stored row.
      await this.lockRoleForLift(em, ability, {
        roleId,
        actorId,
        check,
        lifted: () => []
      });
      await em.save(RolePermission, rolePermissions);
    }, audit);
  }

  async removePermissionFromRole(
    roleId: string,
    permissionId: string,
    { ability, actorId, audit }: RoleWriteOptions
  ): Promise<void> {
    const check = (role: Role) =>
      this.assertCanChangeGrants(ability, role, actorId);

    // Checked here to answer early, and again on the locked row.
    check(await this.loadRole(roleId));
    await this.writeSettings(async (em) => {
      await this.lockRoleForLift(em, ability, {
        roleId,
        actorId,
        check,
        lifted: (rows) =>
          rows.filter((row) => row.permissionId === permissionId)
      });
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
    }, audit);
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
}
