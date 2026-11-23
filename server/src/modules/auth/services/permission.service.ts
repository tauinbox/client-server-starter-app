import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { User } from '../../users/entities/user.entity';
import { UserRole } from '../../users/entities/user-role.entity';
import { attachRoles, findUserWithRoles } from '../../users/utils/user-roles';
import { Role } from '../entities/role.entity';
import { SYSTEM_ROLES } from '@app/shared/constants';
import type {
  PermissionCondition,
  ResolvedPermission
} from '@app/shared/types';
import { dedupPermissions } from '@app/shared/utils/ability-rules';
import { isWithinUserRoleCeiling } from '@app/shared/utils/grant-scope';
import { CacheVersionCounter } from '../../../common/utils/cache-version-counter';
import { MetricsService } from '../../core/metrics/metrics.service';

const CACHE_TTL = 120_000; // 2 minutes
// Versioned: a migration that deletes grants must not be outlived by a cached
// list that still carries them.
const CACHE_PREFIX = 'permissions:v2:';
const ROLES_CACHE_PREFIX = 'roles:';
// One counter per user for both lists: a role change alters both.
const VERSION_KEY = 'permissions:user-version';
const VERSION_COUNTER_KEY = 'permissions:user-version:counter';

function permissionsCacheKey(userId: string, version: number): string {
  return `${CACHE_PREFIX}${userId}:v${version}`;
}

function rolesCacheKey(userId: string, version: number): string {
  return `${ROLES_CACHE_PREFIX}${userId}:v${version}`;
}

export interface RoleInfo {
  name: string;
  isSuper: boolean;
}

@Injectable()
export class PermissionService {
  readonly #logger = new Logger(PermissionService.name);
  readonly #version: CacheVersionCounter<string>;
  readonly #droppedCeilingGrants = new Set<string>();

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly metrics: MetricsService
  ) {
    this.#version = new CacheVersionCounter<string>(cacheManager, {
      counterKey: VERSION_COUNTER_KEY,
      fallbackKey: VERSION_KEY,
      logger: this.#logger,
      entryKeys: (version, userId) => [
        permissionsCacheKey(userId, version),
        rolesCacheKey(userId, version)
      ]
    });
  }

  async getPermissionsForUser(userId: string): Promise<ResolvedPermission[]> {
    // A falsy id is dropped from the WHERE clause and would resolve to an
    // arbitrary user's permissions instead of none.
    if (!userId) {
      return [];
    }

    const version = await this.#version.read(userId);
    const cacheKey = permissionsCacheKey(userId, version);
    const cached = await this.cacheManager.get<ResolvedPermission[]>(cacheKey);

    this.metrics.recordCacheAccess('permissions', cached ? 'hit' : 'miss');

    if (cached) {
      return cached;
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      return [];
    }

    await attachRoles(this.userRepository.manager, [user], {
      rolePermissions: { permission: { resource: true, action: true } }
    });

    const permissions = dedupPermissions(
      user.roles.flatMap((role) =>
        role.rolePermissions
          .map((rp) => ({
            resource: rp.permission.resource.name,
            action: rp.permission.action.name,
            conditions: rp.conditions
          }))
          .filter(
            (grant) =>
              role.name !== SYSTEM_ROLES.USER || this.#keepUserRoleGrant(grant)
          )
      )
    );

    await this.cacheManager.set(cacheKey, permissions, CACHE_TTL);

    return permissions;
  }

  #keepUserRoleGrant(grant: {
    resource: string;
    action: string;
    conditions: PermissionCondition | null;
  }): boolean {
    if (isWithinUserRoleCeiling(grant)) return true;

    const { action, resource } = grant;
    const label = `${action}:${resource}`;

    if (!this.#droppedCeilingGrants.has(label)) {
      this.#droppedCeilingGrants.add(label);
      this.#logger.warn(
        `The ${SYSTEM_ROLES.USER} role holds ${label} outside its ceiling; the grant is ignored`
      );
    }

    return false;
  }

  async getRolesForUser(userId: string): Promise<RoleInfo[]> {
    // See getPermissionsForUser: a falsy id must resolve to no roles, not to
    // whichever user the unconstrained query happens to return.
    if (!userId) {
      return [];
    }

    const version = await this.#version.read(userId);
    const cacheKey = rolesCacheKey(userId, version);
    const cached = await this.cacheManager.get<RoleInfo[]>(cacheKey);

    this.metrics.recordCacheAccess('roles', cached ? 'hit' : 'miss');

    if (cached) {
      return cached;
    }

    const user = await findUserWithRoles(this.userRepository.manager, {
      where: { id: userId }
    });

    const roles: RoleInfo[] =
      user?.roles?.map((r) => ({ name: r.name, isSuper: r.isSuper })) ?? [];

    await this.cacheManager.set(cacheKey, roles, CACHE_TTL);

    return roles;
  }

  async getRoleNamesForUser(userId: string): Promise<string[]> {
    const roles = await this.getRolesForUser(userId);

    return roles.map((r) => r.name);
  }

  /**
   * The users of `userIds` that can pass a check of `action` on `subject`: a
   * super role, or an allow of that action on that subject. Read from the
   * database without the cache, so the result is never older than the cache.
   * The ability still decides; this only removes users it cannot allow.
   */
  async filterGrantHolders(
    userIds: string[],
    action: string,
    subject: string
  ): Promise<string[]> {
    if (userIds.length === 0) {
      return [];
    }

    const { manager } = this.userRepository;
    // Two reads, no join: the memberships are personal data and the roles are
    // settings. One array parameter: a spread list stops at the 65535
    // parameters of the Postgres protocol.
    const links = await manager
      .createQueryBuilder(UserRole, 'link')
      .select(['link.userId', 'link.roleId'])
      .innerJoin(
        User,
        'user',
        'user.id = link.userId AND user.deletedAt IS NULL'
      )
      .where('link.userId = ANY(CAST(:userIds AS uuid[]))', { userIds })
      .getMany();

    if (links.length === 0) {
      return [];
    }

    const allowing = await manager
      .createQueryBuilder(Role, 'role')
      .select('role.id', 'id')
      .distinct(true)
      .leftJoin('role.rolePermissions', 'rp')
      .leftJoin('rp.permission', 'permission')
      .leftJoin('permission.action', 'action')
      .leftJoin('permission.resource', 'resource')
      .where('role.id = ANY(CAST(:roleIds AS uuid[]))', {
        roleIds: [...new Set(links.map(({ roleId }) => roleId))]
      })
      .andWhere(
        new Brackets((qb) =>
          qb.where('role.isSuper = true').orWhere(
            `action.name = :action AND resource.subject = :subject
              AND (rp.conditions IS NULL OR rp.conditions->>'effect' IS DISTINCT FROM 'deny')`,
            { action, subject }
          )
        )
      )
      .getRawMany<{ id: string }>();
    const allowingIds = new Set(allowing.map(({ id }) => id));

    return [
      ...new Set(
        links
          .filter(({ roleId }) => allowingIds.has(roleId))
          .map(({ userId }) => userId)
      )
    ];
  }

  async invalidateUserCache(userId: string): Promise<void> {
    await this.#version.bump(userId);
  }
}
