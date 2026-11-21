import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { User } from '../../users/entities/user.entity';
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

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: {
        roles: {
          rolePermissions: {
            permission: {
              resource: true,
              action: true
            }
          }
        }
      }
    });

    if (!user) {
      return [];
    }

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

    const label = `${grant.action}:${grant.resource}`;

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

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: { roles: true }
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

    const rows = await this.userRepository
      .createQueryBuilder('user')
      .select('user.id', 'id')
      .distinct(true)
      .innerJoin('user.roles', 'role')
      .leftJoin('role.rolePermissions', 'rp')
      .leftJoin('rp.permission', 'permission')
      .leftJoin('permission.action', 'action')
      .leftJoin('permission.resource', 'resource')
      // One array parameter: a spread list stops at the 65535 parameters of
      // the Postgres protocol.
      .where('user.id = ANY(CAST(:userIds AS uuid[]))', { userIds })
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

    return rows.map((row) => row.id);
  }

  async invalidateUserCache(userId: string): Promise<void> {
    await this.#version.bump(userId);
  }
}
