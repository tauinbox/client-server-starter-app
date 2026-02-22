import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RoleService } from './role.service';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { PermissionService } from './permission.service';

describe('RoleService', () => {
  let service: RoleService;
  let mockRoleRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    manager: { connection: { createQueryRunner: jest.Mock } };
    createQueryBuilder: jest.Mock;
  };
  let mockPermissionRepo: { find: jest.Mock };
  let mockRolePermissionRepo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let mockPermissionService: { invalidateUserPermissions: jest.Mock };
  let mockQueryRunner: {
    connect: jest.Mock;
    release: jest.Mock;
    query: jest.Mock;
  };

  const systemRole: Role = {
    id: 'role-1',
    name: 'admin',
    description: 'Admin role',
    isSystem: true,
    rolePermissions: [],
    users: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const customRole: Role = {
    id: 'role-2',
    name: 'editor',
    description: 'Editor role',
    isSystem: false,
    rolePermissions: [],
    users: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  beforeEach(async () => {
    mockQueryRunner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest.fn()
    };

    mockRoleRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) => data),
      save: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) =>
          Promise.resolve({ id: 'new-role', ...data })
        ),
      remove: jest.fn(),
      manager: {
        connection: {
          createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner)
        }
      },
      createQueryBuilder: jest.fn()
    };

    mockPermissionRepo = {
      find: jest.fn()
    };

    mockRolePermissionRepo = {
      find: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) => data),
      save: jest.fn(),
      delete: jest.fn()
    };

    mockPermissionService = {
      invalidateUserPermissions: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleService,
        { provide: getRepositoryToken(Role), useValue: mockRoleRepo },
        {
          provide: getRepositoryToken(Permission),
          useValue: mockPermissionRepo
        },
        {
          provide: getRepositoryToken(RolePermission),
          useValue: mockRolePermissionRepo
        },
        { provide: PermissionService, useValue: mockPermissionService }
      ]
    }).compile();

    service = module.get<RoleService>(RoleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all roles', async () => {
      mockRoleRepo.find.mockResolvedValue([systemRole, customRole]);
      const result = await service.findAll();
      expect(result).toHaveLength(2);
    });
  });

  describe('findOne', () => {
    it('should return a role by id', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);
      const result = await service.findOne('role-1');
      expect(result.name).toBe('admin');
    });

    it('should throw NotFoundException if not found', async () => {
      mockRoleRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('bad-id')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('create', () => {
    it('should create a new role', async () => {
      mockRoleRepo.findOne.mockResolvedValue(null);
      const result = await service.create({
        name: 'viewer',
        description: 'View only'
      });
      expect(result.name).toBe('viewer');
    });

    it('should throw if name already exists', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      await expect(service.create({ name: 'editor' })).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe('update', () => {
    it('should throw if role is system', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);
      await expect(
        service.update('role-1', { name: 'superadmin' })
      ).rejects.toThrow(BadRequestException);
    });

    it('should update a custom role', async () => {
      mockRoleRepo.findOne.mockResolvedValueOnce(customRole);
      mockRoleRepo.findOne.mockResolvedValueOnce(null); // no name conflict
      mockRoleRepo.save.mockResolvedValue({
        ...customRole,
        description: 'Updated'
      });

      const result = await service.update('role-2', {
        description: 'Updated'
      });
      expect(result.description).toBe('Updated');
    });
  });

  describe('delete', () => {
    it('should throw if role is system', async () => {
      mockRoleRepo.findOne.mockResolvedValue(systemRole);
      await expect(service.delete('role-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('should delete a custom role', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      await service.delete('role-2');
      expect(mockRoleRepo.remove).toHaveBeenCalledWith(customRole);
    });
  });

  describe('assignRoleToUser', () => {
    it('should assign role and invalidate cache', async () => {
      mockRoleRepo.findOne.mockResolvedValue(customRole);
      await service.assignRoleToUser('user-1', 'role-2');

      expect(mockQueryRunner.query).toHaveBeenCalled();
      expect(
        mockPermissionService.invalidateUserPermissions
      ).toHaveBeenCalledWith('user-1');
    });
  });

  describe('removeRoleFromUser', () => {
    it('should remove role and invalidate cache', async () => {
      await service.removeRoleFromUser('user-1', 'role-2');

      expect(mockQueryRunner.query).toHaveBeenCalled();
      expect(
        mockPermissionService.invalidateUserPermissions
      ).toHaveBeenCalledWith('user-1');
    });
  });

  describe('findAllPermissions', () => {
    it('should return all permissions', async () => {
      const permissions = [{ id: 'p1', resource: 'users', action: 'read' }];
      mockPermissionRepo.find.mockResolvedValue(permissions);
      const result = await service.findAllPermissions();
      expect(result).toEqual(permissions);
    });
  });
});
