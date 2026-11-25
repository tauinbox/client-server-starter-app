import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, Repository } from 'typeorm';
import { SETTINGS_DATA_SOURCE } from '../../../data-sources';
import type { SourceManagers } from '../../../data-sources';
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
// list that still carries them, and an entry of another shape is not read.
const CACHE_PREFIX = 'permissions:v3:';
const ROLES_CACHE_PREFIX = 'roles:v2:';
// One counter per user for both lists: a role change alters both.
const VERSION_KEY = 'permissions:user-version';
const VERSION_COUNTER_KEY = 'permissions:user-version:counter';
// Drops the lists of every user at once. It is stored in each entry and not in
// the key, so a failed per-user bump still knows the keys it must delete.
const GLOBAL_VERSION_KEY = 'permissions:global-version';
const GLOBAL_VERSION_COUNTER_KEY = 'permissions:global-version:counter';

interface CachedList<T> {
  global: number;
  value: T;
}

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
  readonly #globalVersion: CacheVersionCounter;
  readonly #droppedCeilingGrants = new Set<string>();

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectDataSource(SETTINGS_DATA_SOURCE)
    private readonly settingsDataSource: DataSource,
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
    // No key to delete when its INCR fails: the entries stay until their TTL,
    // and the failure is logged (MR-D1).
    this.#globalVersion = new CacheVersionCounter(cacheManager, {
      counterKey: GLOBAL_VERSION_COUNTER_KEY,
      fallbackKey: GLOBAL_VERSION_KEY,
      logger: this.#logger,
      entryKeys: () => []
    });
  }

  get #managers(): SourceManagers {
    return {
      regional: this.userRepository.manager,
      settings: this.settingsDataSource.manager
    };
  }

  /**
   * Both versions are read before the query, so a read that started before a
   * drop writes an entry that nobody reads again. `load` answers null for a
   * result that must not be cached.
   */
  async #readThrough<T>(
    userId: string,
    {
      metric,
      key,
      load
    }: {
      metric: 'permissions' | 'roles';
      key: (userId: string, version: number) => string;
      load: () => Promise<T | null>;
    }
  ): Promise<T | null> {
    const [version, global] = await Promise.all([
      this.#version.read(userId),
      this.#globalVersion.read()
    ]);
    const cacheKey = key(userId, version);
    const cached = await this.cacheManager.get<CachedList<T>>(cacheKey);
    const hit = cached?.global === global;

    this.metrics.recordCacheAccess(metric, hit ? 'hit' : 'miss');

    if (cached && hit) return cached.value;

    const value = await load();

    if (value !== null) {
      await this.cacheManager.set(cacheKey, { global, value }, CACHE_TTL);
    }

    return value;
  }

  async getPermissionsForUser(userId: string): Promise<ResolvedPermission[]> {
    // A falsy id is dropped from the WHERE clause and would resolve to an
    // arbitrary user's permissions instead of none.
    if (!userId) {
      return [];
    }

    const permissions = await this.#readThrough(userId, {
      metric: 'permissions',
      key: permissionsCacheKey,
      load: () => this.#resolvePermissions(userId)
    });

    return permissions ?? [];
  }

  async #resolvePermissions(
    userId: string
  ): Promise<ResolvedPermission[] | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      return null;
    }

    await attachRoles(this.#managers, [user], {
      rolePermissions: { permission: { resource: true, action: true } }
    });

    return dedupPermissions(
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

    const roles = await this.#readThrough(userId, {
      metric: 'roles',
      key: rolesCacheKey,
      load: async () => {
        const user = await findUserWithRoles(this.#managers, {
          where: { id: userId }
        });

        return (
          user?.roles?.map((r) => ({ name: r.name, isSuper: r.isSuper })) ?? []
        );
      }
    });

    return roles ?? [];
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

    const allowing = await this.settingsDataSource.manager
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

  /** Drops the cached lists of every user: a rebase of the settings log. */
  async invalidateAll(): Promise<void> {
    await this.#globalVersion.bump();
  }

  /**
   * The users that hold one of `roleIds`, read on `manager` so that the apply
   * of the settings log needs no second connection. Soft-deleted users have no
   * session to refresh.
   */
  async findHolderIds(
    manager: EntityManager,
    roleIds: readonly string[]
  ): Promise<string[]> {
    if (roleIds.length === 0) return [];

    const links = await manager
      .createQueryBuilder(UserRole, 'link')
      .select('link.userId')
      .innerJoin(
        User,
        'user',
        'user.id = link.userId AND user.deletedAt IS NULL'
      )
      .where('link.roleId = ANY(CAST(:roleIds AS uuid[]))', {
        roleIds: [...roleIds]
      })
      .getMany();

    return [...new Set(links.map(({ userId }) => userId))];
  }
}
