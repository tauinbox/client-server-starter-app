import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Action } from '../entities/action.entity';
import { Permission } from '../entities/permission.entity';
import { Resource } from '../entities/resource.entity';
import { RolePermission } from '../entities/role-permission.entity';

@Injectable()
export class ActionService {
  constructor(
    @InjectRepository(Action)
    private readonly actionRepository: Repository<Action>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(Resource)
    private readonly resourceRepository: Repository<Resource>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>
  ) {}

  async findAll(): Promise<Action[]> {
    return this.actionRepository.find({ order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<Action> {
    const action = await this.actionRepository.findOne({ where: { id } });
    if (!action) {
      throw new NotFoundException('Action not found');
    }
    return action;
  }

  async create(data: {
    name: string;
    displayName: string;
    description: string;
  }): Promise<Action> {
    const normalizedName = data.name.toLowerCase().trim();

    const existing = await this.actionRepository.findOne({
      where: { name: normalizedName }
    });
    if (existing) {
      throw new BadRequestException('Action with this name already exists');
    }

    const action = this.actionRepository.create({
      ...data,
      name: normalizedName,
      isDefault: false
    });
    const saved = await this.actionRepository.save(action);

    // Auto-create permissions for all existing resources
    const resources = await this.resourceRepository.find();
    if (resources.length > 0) {
      const permissions = resources.map((resource) =>
        this.permissionRepository.create({
          resourceId: resource.id,
          actionId: saved.id
        })
      );
      await this.permissionRepository.save(permissions);
    }

    return saved;
  }

  async update(
    id: string,
    data: { displayName?: string; description?: string }
  ): Promise<Action> {
    const action = await this.findOne(id);
    Object.assign(action, data);
    return this.actionRepository.save(action);
  }

  async delete(id: string): Promise<void> {
    const action = await this.findOne(id);

    if (action.isDefault) {
      throw new ForbiddenException('Cannot delete default actions');
    }

    // Check if any role_permissions reference permissions with this action
    const usedCount = await this.rolePermissionRepository
      .createQueryBuilder('rp')
      .innerJoin('rp.permission', 'p')
      .where('p.action_id = :actionId', { actionId: id })
      .getCount();

    if (usedCount > 0) {
      throw new ConflictException(
        'Cannot delete action that is assigned to roles. Remove it from all roles first.'
      );
    }

    // Delete associated permissions first (FK RESTRICT would block otherwise)
    await this.permissionRepository.delete({ actionId: id });
    await this.actionRepository.remove(action);
  }
}
