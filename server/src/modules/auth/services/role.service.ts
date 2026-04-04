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

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    private readonly permissionService: PermissionService
  ) {}

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
    ability?: AppAbility
  ): Promise<void> {
    const role = await this.findOne(roleId);

    if (ability) {
      if (role.isSuper) {
        throw new ForbiddenException('Cannot assign super roles');
      }
      const targetUser = await this.roleRepository.manager.findOne(User, {
        where: { id: userId }
      });
      if (targetUser && !ability.can('update', targetUser)) {
        throw new ForbiddenException('Insufficient permissions');
      }
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
      if (targetUser && !ability.can('update', targetUser)) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    await this.roleRepository.manager
      .createQueryBuilder()
      .relation(User, 'roles')
      .of(userId)
      .remove(roleId);
    if (role.isSuper) {
      await this.roleRepository.manager.update(User, userId, {
        tokenRevokedAt: new Date()
      });
    }
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
    items: { permissionId: string; conditions?: PermissionCondition | null }[]
  ): Promise<void> {
    await this.findOne(roleId);
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
    conditions?: PermissionCondition
  ): Promise<void> {
    await this.findOne(roleId);
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
    permissionId: string
  ): Promise<void> {
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
