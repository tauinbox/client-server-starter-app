import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { User } from '../../users/entities/user.entity';
import { ResolvedPermission } from '@app/shared/types';
import type { RoleInfo } from '../casl/casl-ability.factory';

const CACHE_TTL = 120_000; // 2 minutes
const CACHE_PREFIX = 'permissions:';
const ROLES_CACHE_PREFIX = 'roles:';

@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache
  ) {}

  async getPermissionsForUser(userId: string): Promise<ResolvedPermission[]> {
    const cacheKey = `${CACHE_PREFIX}${userId}`;
    const cached = await this.cacheManager.get<ResolvedPermission[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: [
        'roles',
        'roles.rolePermissions',
        'roles.rolePermissions.permission',
        'roles.rolePermissions.permission.resource',
        'roles.rolePermissions.permission.action'
      ]
    });

    if (!user) {
      return [];
    }

    const permissionMap = new Map<string, ResolvedPermission>();

    for (const role of user.roles) {
      for (const rp of role.rolePermissions) {
        const resourceName = rp.permission.resource.name;
        const actionName = rp.permission.action.name;
        const key = `${resourceName}:${actionName}`;
        if (!permissionMap.has(key)) {
          permissionMap.set(key, {
            resource: resourceName,
            action: actionName,
            permission: key,
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
    const cacheKey = `${ROLES_CACHE_PREFIX}${userId}`;
    const cached = await this.cacheManager.get<RoleInfo[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['roles']
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

  async invalidateUserCache(userId: string): Promise<void> {
    await this.cacheManager.del(`${CACHE_PREFIX}${userId}`);
    await this.cacheManager.del(`${ROLES_CACHE_PREFIX}${userId}`);
  }

  async hasPermission(userId: string, permission: string): Promise<boolean> {
    const permissions = await this.getPermissionsForUser(userId);
    return permissions.some((p) => p.permission === permission);
  }
}
