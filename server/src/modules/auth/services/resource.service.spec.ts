import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ResourceService } from './resource.service';
import { ResourceRegistryService } from './resource-registry.service';
import { Resource } from '../entities/resource.entity';

describe('ResourceService', () => {
  let service: ResourceService;
  let mockResourceRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let mockCacheManager: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };
  let mockRegistry: {
    isRegistered: jest.Mock;
    register: jest.Mock;
  };

  const resource1: Resource = {
    id: 'res-1',
    name: 'users',
    subject: 'User',
    displayName: 'Users',
    description: 'User management',
    isSystem: true,
    isOrphaned: false,
    allowedActionNames: null,
    lastSyncedAt: new Date(),
    permissions: [],
    createdAt: new Date()
  };

  const resource2: Resource = {
    id: 'res-2',
    name: 'articles',
    subject: 'Article',
    displayName: 'Articles',
    description: null,
    isSystem: false,
    isOrphaned: false,
    allowedActionNames: null,
    lastSyncedAt: null,
    permissions: [],
    createdAt: new Date()
  };

  const orphanedResource: Resource = {
    id: 'res-3',
    name: 'legacy',
    subject: 'Legacy',
    displayName: 'Legacy',
    description: null,
    isSystem: false,
    isOrphaned: true,
    allowedActionNames: null,
    lastSyncedAt: null,
    permissions: [],
    createdAt: new Date()
  };

  beforeEach(async () => {
    mockResourceRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) => data),
      save: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) =>
          Promise.resolve(data)
        )
    };

    mockCacheManager = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined)
    };

    mockRegistry = {
      isRegistered: jest.fn().mockReturnValue(true),
      register: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourceService,
        {
          provide: getRepositoryToken(Resource),
          useValue: mockResourceRepo
        },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: ResourceRegistryService, useValue: mockRegistry }
      ]
    }).compile();

    service = module.get<ResourceService>(ResourceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all resources ordered by name ASC', async () => {
      mockResourceRepo.find.mockResolvedValue([resource2, resource1]);
      const result = await service.findAll();
      expect(result).toHaveLength(2);
      expect(mockResourceRepo.find).toHaveBeenCalledWith({
        order: { name: 'ASC' }
      });
    });

    it('should populate isRegistered from registry on each resource', async () => {
      mockResourceRepo.find.mockResolvedValue([resource1, resource2]);
      mockRegistry.isRegistered.mockImplementation(
        (name: string) => name === 'users'
      );

      const result = await service.findAll();

      expect(result[0].isRegistered).toBe(true); // users
      expect(result[1].isRegistered).toBe(false); // articles
    });
  });

  describe('findOne', () => {
    it('should return a resource by id', async () => {
      mockResourceRepo.findOne.mockResolvedValue(resource1);
      const result = await service.findOne('res-1');
      expect(result).toEqual(resource1);
      expect(mockResourceRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'res-1' }
      });
    });

    it('should return null if not found', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);
      const result = await service.findOne('bad-id');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update an existing resource', async () => {
      const updatedResource = { ...resource1, displayName: 'Updated Users' };
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      mockResourceRepo.save.mockResolvedValue(updatedResource);

      const result = await service.update('res-1', {
        displayName: 'Updated Users'
      });

      expect(result).toEqual(updatedResource);
      expect(mockResourceRepo.save).toHaveBeenCalled();
    });

    it('should throw Error if resource not found', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('bad-id', { displayName: 'Nope' })
      ).rejects.toThrow('Resource not found');
    });

    it('should invalidate subject map cache after update', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      mockResourceRepo.save.mockResolvedValue(resource1);

      await service.update('res-1', { description: 'New desc' });

      expect(mockCacheManager.del).toHaveBeenCalledWith('rbac:subject_map');
    });

    it('should apply partial update data via Object.assign', async () => {
      const original = { ...resource1 };
      mockResourceRepo.findOne.mockResolvedValue(original);
      mockResourceRepo.save.mockImplementation(
        (data: Record<string, unknown>) => Promise.resolve(data)
      );

      await service.update('res-1', {
        displayName: 'New Name',
        description: null
      });

      expect(mockResourceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'New Name',
          description: null
        })
      );
    });
  });

  describe('getSubjectMap', () => {
    it('should return cached map on cache hit', async () => {
      const cachedMap = { users: 'User', articles: 'Article' };
      mockCacheManager.get.mockResolvedValue(cachedMap);

      const result = await service.getSubjectMap();

      expect(result).toEqual(cachedMap);
      expect(mockResourceRepo.find).not.toHaveBeenCalled();
    });

    it('should build map from DB on cache miss and store in cache', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockResourceRepo.find.mockResolvedValue([resource1, resource2]);

      const result = await service.getSubjectMap();

      expect(result).toEqual({ users: 'User', articles: 'Article' });
      expect(mockResourceRepo.find).toHaveBeenCalled();
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'rbac:subject_map',
        { users: 'User', articles: 'Article' },
        300_000
      );
    });

    it('should exclude orphaned resources from subject map', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockResourceRepo.find.mockResolvedValue([resource1, orphanedResource]);

      const result = await service.getSubjectMap();

      expect(result).toEqual({ users: 'User' });
      expect(result).not.toHaveProperty('legacy');
    });

    it('should return null from cache as a miss', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockResourceRepo.find.mockResolvedValue([]);

      const result = await service.getSubjectMap();

      expect(result).toEqual({});
      expect(mockResourceRepo.find).toHaveBeenCalled();
    });

    it('should return empty map when no resources exist', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockResourceRepo.find.mockResolvedValue([]);

      const result = await service.getSubjectMap();

      expect(result).toEqual({});
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'rbac:subject_map',
        {},
        300_000
      );
    });
  });

  describe('upsertResource', () => {
    it('should update existing resource if found by name', async () => {
      const existing = { ...resource1 };
      mockResourceRepo.findOne.mockResolvedValue(existing);
      mockResourceRepo.save.mockImplementation(
        (data: Record<string, unknown>) => Promise.resolve(data)
      );

      const result = await service.upsertResource({
        name: 'users',
        subject: 'UpdatedUser',
        displayName: 'Updated Users'
      });

      expect(result).toEqual(
        expect.objectContaining({
          subject: 'UpdatedUser',
          displayName: 'Updated Users'
        })
      );
      expect(mockResourceRepo.findOne).toHaveBeenCalledWith({
        where: { name: 'users' }
      });
      expect(mockResourceRepo.create).not.toHaveBeenCalled();
    });

    it('should set lastSyncedAt when updating existing resource', async () => {
      const existing = { ...resource1 };
      mockResourceRepo.findOne.mockResolvedValue(existing);
      mockResourceRepo.save.mockImplementation(
        (data: Record<string, unknown>) => Promise.resolve(data)
      );

      await service.upsertResource({
        name: 'users',
        subject: 'User',
        displayName: 'Users'
      });

      expect(existing.lastSyncedAt).toBeInstanceOf(Date);
    });

    it('should create new resource if not found by name', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);

      const result = await service.upsertResource({
        name: 'posts',
        subject: 'Post',
        displayName: 'Posts'
      });

      expect(mockResourceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'posts',
          subject: 'Post',
          displayName: 'Posts',
          isSystem: false
        })
      );
      expect(mockResourceRepo.save).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({ name: 'posts', subject: 'Post' })
      );
    });

    it('should respect isSystem flag when creating new resource', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);

      await service.upsertResource({
        name: 'settings',
        subject: 'Setting',
        displayName: 'Settings',
        isSystem: true
      });

      expect(mockResourceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ isSystem: true })
      );
    });

    it('should default isSystem to false when not provided', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);

      await service.upsertResource({
        name: 'reports',
        subject: 'Report',
        displayName: 'Reports'
      });

      expect(mockResourceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ isSystem: false })
      );
    });

    it('should throw BadRequestException when subject is CASL reserved word "all"', async () => {
      await expect(
        service.upsertResource({
          name: 'everything',
          subject: 'all',
          displayName: 'Everything'
        })
      ).rejects.toThrow(BadRequestException);
      expect(mockResourceRepo.findOne).not.toHaveBeenCalled();
    });

    it('should reject reserved subject even with mixed case', async () => {
      await expect(
        service.upsertResource({
          name: 'everything',
          subject: 'ALL',
          displayName: 'Everything'
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should normalize lowercase subject to PascalCase when creating', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);

      await service.upsertResource({
        name: 'posts',
        subject: 'post',
        displayName: 'Posts'
      });

      expect(mockResourceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Post' })
      );
    });

    it('should normalize lowercase subject to PascalCase when updating existing', async () => {
      const existing = { ...resource1 };
      mockResourceRepo.findOne.mockResolvedValue(existing);
      mockResourceRepo.save.mockImplementation(
        (data: Record<string, unknown>) => Promise.resolve(data)
      );

      await service.upsertResource({
        name: 'users',
        subject: 'user',
        displayName: 'Users'
      });

      expect(existing.subject).toBe('User');
    });

    it('should leave already-PascalCase subject unchanged', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);

      await service.upsertResource({
        name: 'posts',
        subject: 'Post',
        displayName: 'Posts'
      });

      expect(mockResourceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Post' })
      );
    });
  });

  describe('restore', () => {
    it('should set isOrphaned to false and save', async () => {
      const orphaned = { ...orphanedResource };
      mockResourceRepo.findOne.mockResolvedValue(orphaned);
      mockResourceRepo.save.mockImplementation(
        (data: Record<string, unknown>) => Promise.resolve(data)
      );

      const result = await service.restore('res-3');

      expect(result).toMatchObject({ isOrphaned: false });
      expect(mockResourceRepo.save).toHaveBeenCalled();
    });

    it('should set isRegistered to true on returned resource', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });
      mockResourceRepo.save.mockImplementation(
        (data: Record<string, unknown>) => Promise.resolve(data)
      );

      const result = await service.restore('res-3');

      expect(result.isRegistered).toBe(true);
    });

    it('should invalidate subject map cache after restore', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });
      mockResourceRepo.save.mockImplementation(
        (data: Record<string, unknown>) => Promise.resolve(data)
      );

      await service.restore('res-3');

      expect(mockCacheManager.del).toHaveBeenCalledWith('rbac:subject_map');
    });

    it('should throw NotFoundException if resource not found', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);

      await expect(service.restore('bad-id')).rejects.toThrow(
        'Resource not found'
      );
    });

    it('should throw BadRequestException if controller is not registered', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });
      mockRegistry.isRegistered.mockReturnValue(false);

      await expect(service.restore('res-3')).rejects.toThrow(
        BadRequestException
      );
      expect(mockResourceRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('invalidateSubjectMapCache', () => {
    it('should delete the subject map cache entry', async () => {
      await service.invalidateSubjectMapCache();
      expect(mockCacheManager.del).toHaveBeenCalledWith('rbac:subject_map');
    });
  });
});
