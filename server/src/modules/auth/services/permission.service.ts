import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { User } from '../../users/entities/user.entity';
import { ResolvedPermission } from '@app/shared/types';
import { MetricsService } from '../../core/metrics/metrics.service';

const CACHE_TTL = 120_000; // 2 minutes
// Versioned: a migration that deletes grants must not be outlived by a cached
// list that still carries them.
const CACHE_PREFIX = 'permissions:v2:';
const ROLES_CACHE_PREFIX = 'roles:';

export interface RoleInfo {
  name: string;
  isSuper: boolean;
}

@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly metrics: MetricsService
  ) {}

  async getPermissionsForUser(userId: string): Promise<ResolvedPermission[]> {
    // A falsy id is dropped from the WHERE clause and would resolve to an
    // arbitrary user's permissions instead of none.
    if (!userId) {
      return [];
    }

    const cacheKey = `${CACHE_PREFIX}${userId}`;
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

    // Conditions are part of the key: two restriction roles on one permission
    // are two denies, and dropping either widens the grant. jsonb key order is
    // stable, so equal conditions still dedup.
    const permissionMap = new Map<string, ResolvedPermission>();

    for (const role of user.roles) {
      for (const rp of role.rolePermissions) {
        const resourceName = rp.permission.resource.name;
        const actionName = rp.permission.action.name;
        const effect = rp.conditions?.effect === 'deny' ? 'deny' : 'allow';
        const key = `${effect}:${resourceName}:${actionName}:${JSON.stringify(rp.conditions ?? null)}`;
        if (!permissionMap.has(key)) {
          permissionMap.set(key, {
            resource: resourceName,
            action: actionName,
            permission: `${resourceName}:${actionName}`,
            conditions: rp.conditions
          });
        }
      }
    }

    const permissions = Array.from(permissionMap.values());
    await this.cacheManager.set(cacheKey, permissions, CACHE_TTL);
    return permissions;
  }

  async getRolesForUser(userId: string): Promise<RoleInfo[]> {
    // See getPermissionsForUser: a falsy id must resolve to no roles, not to
    // whichever user the unconstrained query happens to return.
    if (!userId) {
      return [];
    }

    const cacheKey = `${ROLES_CACHE_PREFIX}${userId}`;
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
    await this.cacheManager.del(`${CACHE_PREFIX}${userId}`);
    await this.cacheManager.del(`${ROLES_CACHE_PREFIX}${userId}`);
  }
}
