import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpException } from '@nestjs/common';
import { ActionService } from './action.service';
import { Action } from '../entities/action.entity';
import { Permission } from '../entities/permission.entity';
import { Resource } from '../entities/resource.entity';
import { RolePermission } from '../entities/role-permission.entity';

describe('ActionService', () => {
  let service: ActionService;
  let mockActionRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let mockPermissionRepo: {
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let mockResourceRepo: {
    find: jest.Mock;
  };
  let mockRolePermissionRepo: {
    createQueryBuilder: jest.Mock;
  };
  let mockQueryBuilder: {
    innerJoin: jest.Mock;
    where: jest.Mock;
    getCount: jest.Mock;
  };

  const makeDefaultAction = (): Action => ({
    id: 'action-1',
    name: 'read',
    displayName: 'Read',
    description: 'Read access',
    isDefault: true,
    permissions: [],
    createdAt: new Date()
  });

  const makeCustomAction = (): Action => ({
    id: 'action-2',
    name: 'export',
    displayName: 'Export',
    description: 'Export data',
    isDefault: false,
    permissions: [],
    createdAt: new Date()
  });

  beforeEach(async () => {
    mockQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0)
    };

    mockActionRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) => data),
      save: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) =>
          Promise.resolve({ id: 'new-action', ...data })
        ),
      remove: jest.fn()
    };

    mockPermissionRepo = {
      create: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) => data),
      save: jest.fn().mockResolvedValue([]),
      delete: jest.fn()
    };

    mockResourceRepo = {
      find: jest.fn().mockResolvedValue([])
    };

    mockRolePermissionRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActionService,
        { provide: getRepositoryToken(Action), useValue: mockActionRepo },
        {
          provide: getRepositoryToken(Permission),
          useValue: mockPermissionRepo
        },
        { provide: getRepositoryToken(Resource), useValue: mockResourceRepo },
        {
          provide: getRepositoryToken(RolePermission),
          useValue: mockRolePermissionRepo
        }
      ]
    }).compile();

    service = module.get<ActionService>(ActionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all actions ordered by name ASC', async () => {
      mockActionRepo.find.mockResolvedValue([
        makeCustomAction(),
        makeDefaultAction()
      ]);
      const result = await service.findAll();
      expect(result).toHaveLength(2);
      expect(mockActionRepo.find).toHaveBeenCalledWith({
        order: { name: 'ASC' }
      });
    });

    it('should return empty array when no actions exist', async () => {
      mockActionRepo.find.mockResolvedValue([]);
      const result = await service.findAll();
      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return an action by id', async () => {
      mockActionRepo.findOne.mockResolvedValue(makeDefaultAction());
      const result = await service.findOne('action-1');
      expect(result.name).toBe('read');
      expect(mockActionRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'action-1' }
      });
    });

    it('should throw NotFoundException if not found', async () => {
      mockActionRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('bad-id')).rejects.toThrow(HttpException);
    });
  });

  describe('create', () => {
    const createData = {
      name: 'Export',
      displayName: 'Export',
      description: 'Export data'
    };

    it('should create a new action with normalized name and isDefault false', async () => {
      mockActionRepo.findOne.mockResolvedValue(null);
      const result = await service.create(createData);
      expect(mockActionRepo.create).toHaveBeenCalledWith({
        ...createData,
        name: 'export',
        isDefault: false
      });
      expect(result.name).toBe('export');
      expect(result.isDefault).toBe(false);
    });

    it('should normalize name by lowercasing and trimming', async () => {
      mockActionRepo.findOne.mockResolvedValue(null);
      await service.create({
        name: '  Export  ',
        displayName: 'Export',
        description: 'Export data'
      });
      expect(mockActionRepo.findOne).toHaveBeenCalledWith({
        where: { name: 'export' }
      });
      expect(mockActionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'export' })
      );
    });

    it('should throw BadRequestException if name already exists', async () => {
      mockActionRepo.findOne.mockResolvedValue(makeCustomAction());
      await expect(service.create(createData)).rejects.toThrow(HttpException);
    });

    it('should throw BadRequestException when name is a CASL reserved word "manage"', async () => {
      await expect(
        service.create({
          name: 'manage',
          displayName: 'Manage',
          description: ''
        })
      ).rejects.toThrow(HttpException);
      expect(mockActionRepo.findOne).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when name is a CASL reserved word "all"', async () => {
      await expect(
        service.create({ name: 'all', displayName: 'All', description: '' })
      ).rejects.toThrow(HttpException);
      expect(mockActionRepo.findOne).not.toHaveBeenCalled();
    });

    it('should reject reserved names even with mixed case input', async () => {
      await expect(
        service.create({
          name: 'MANAGE',
          displayName: 'Manage',
          description: ''
        })
      ).rejects.toThrow(HttpException);
    });

    it('should auto-create permissions for all existing resources', async () => {
      mockActionRepo.findOne.mockResolvedValue(null);
      const resources = [
        { id: 'res-1', name: 'users' },
        { id: 'res-2', name: 'roles' }
      ];
      mockResourceRepo.find.mockResolvedValue(resources);

      await service.create(createData);

      expect(mockPermissionRepo.create).toHaveBeenCalledTimes(2);
      expect(mockPermissionRepo.create).toHaveBeenCalledWith({
        resourceId: 'res-1',
        actionId: 'new-action'
      });
      expect(mockPermissionRepo.create).toHaveBeenCalledWith({
        resourceId: 'res-2',
        actionId: 'new-action'
      });
      expect(mockPermissionRepo.save).toHaveBeenCalled();
    });

    it('should not create permissions when no resources exist', async () => {
      mockActionRepo.findOne.mockResolvedValue(null);
      mockResourceRepo.find.mockResolvedValue([]);

      await service.create(createData);

      expect(mockPermissionRepo.create).not.toHaveBeenCalled();
      expect(mockPermissionRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update an existing action', async () => {
      mockActionRepo.findOne.mockResolvedValue(makeCustomAction());
      mockActionRepo.save.mockResolvedValue({
        ...makeCustomAction(),
        description: 'Updated'
      });

      const result = await service.update('action-2', {
        description: 'Updated'
      });
      expect(result.description).toBe('Updated');
      expect(mockActionRepo.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException if action does not exist', async () => {
      mockActionRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('bad-id', { description: 'Updated' })
      ).rejects.toThrow(HttpException);
    });

    it('should update only provided fields', async () => {
      const action: Action = {
        id: 'action-2',
        name: 'export',
        displayName: 'Export',
        description: 'Export data',
        isDefault: false,
        permissions: [],
        createdAt: new Date()
      };
      mockActionRepo.findOne.mockResolvedValue(action);
      mockActionRepo.save.mockImplementation((data: Record<string, unknown>) =>
        Promise.resolve(data)
      );

      await service.update('action-2', { displayName: 'New Display' });

      expect(mockActionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'New Display',
          description: 'Export data'
        })
      );
    });
  });

  describe('delete', () => {
    it('should throw ForbiddenException if action is default', async () => {
      mockActionRepo.findOne.mockResolvedValue(makeDefaultAction());
      await expect(service.delete('action-1')).rejects.toThrow(HttpException);
    });

    it('should throw ConflictException if action is used by role permissions', async () => {
      mockActionRepo.findOne.mockResolvedValue(makeCustomAction());
      mockQueryBuilder.getCount.mockResolvedValue(3);

      await expect(service.delete('action-2')).rejects.toThrow(HttpException);
    });

    it('should delete associated permissions then the action', async () => {
      const action = makeCustomAction();
      mockActionRepo.findOne.mockResolvedValue(action);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      await service.delete('action-2');

      expect(mockPermissionRepo.delete).toHaveBeenCalledWith({
        actionId: 'action-2'
      });
      expect(mockActionRepo.remove).toHaveBeenCalledWith(action);
    });

    it('should use queryBuilder to check role permission usage', async () => {
      mockActionRepo.findOne.mockResolvedValue(makeCustomAction());
      mockQueryBuilder.getCount.mockResolvedValue(0);

      await service.delete('action-2');

      expect(mockRolePermissionRepo.createQueryBuilder).toHaveBeenCalledWith(
        'rp'
      );
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'rp.permission',
        'p'
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'p.action_id = :actionId',
        { actionId: 'action-2' }
      );
    });

    it('should throw NotFoundException if action does not exist', async () => {
      mockActionRepo.findOne.mockResolvedValue(null);
      await expect(service.delete('bad-id')).rejects.toThrow(HttpException);
    });

    it('should delete permissions before removing action to avoid FK constraint', async () => {
      mockActionRepo.findOne.mockResolvedValue(makeCustomAction());
      mockQueryBuilder.getCount.mockResolvedValue(0);

      const callOrder: string[] = [];
      mockPermissionRepo.delete.mockImplementation(() => {
        callOrder.push('permissionDelete');
        return Promise.resolve({ affected: 1 });
      });
      mockActionRepo.remove.mockImplementation(() => {
        callOrder.push('actionRemove');
        return Promise.resolve(makeCustomAction());
      });

      await service.delete('action-2');

      expect(callOrder).toEqual(['permissionDelete', 'actionRemove']);
    });
  });
});
