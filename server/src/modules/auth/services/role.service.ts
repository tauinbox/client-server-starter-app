import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { User } from '../../users/entities/user.entity';
import { PermissionService } from './permission.service';
import { PermissionCondition } from '@app/shared/types';

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
      throw new NotFoundException('Role not found');
    }
    return role;
  }

  async create(data: { name: string; description?: string }): Promise<Role> {
    const existing = await this.roleRepository.findOne({
      where: { name: data.name }
    });
    if (existing) {
      throw new BadRequestException('Role with this name already exists');
    }
    const role = this.roleRepository.create(data);
    return this.roleRepository.save(role);
  }

  async update(
    id: string,
    data: { name?: string; description?: string }
  ): Promise<Role> {
    const role = await this.findOne(id);
    if (role.isSystem) {
      throw new BadRequestException('Cannot modify system roles');
    }
    if (data.name) {
      const existing = await this.roleRepository.findOne({
        where: { name: data.name }
      });
      if (existing && existing.id !== id) {
        throw new BadRequestException('Role with this name already exists');
      }
    }
    Object.assign(role, data);
    return this.roleRepository.save(role);
  }

  async delete(id: string): Promise<void> {
    const role = await this.findOne(id);
    if (role.isSystem) {
      throw new BadRequestException('Cannot delete system roles');
    }
    await this.invalidateUsersWithRole(id);
    await this.roleRepository.remove(role);
  }

  async assignRoleToUser(userId: string, roleId: string): Promise<void> {
    await this.findOne(roleId);
    await this.roleRepository.manager
      .createQueryBuilder()
      .relation(User, 'roles')
      .of(userId)
      .add(roleId);
    await this.permissionService.invalidateUserCache(userId);
  }

  async removeRoleFromUser(userId: string, roleId: string): Promise<void> {
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
      order: { resource: 'ASC', action: 'ASC' }
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
