import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ResourceService } from './resource.service';
import { ResourceRegistryService } from './resource-registry.service';
import { Resource } from '../entities/resource.entity';
import { MetricsService } from '../../core/metrics/metrics.service';

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
  let mockMetrics: { recordCacheAccess: jest.Mock };

  const resource1: Resource = {
    id: 'res-1',
    name: 'users',
    subject: 'User',
    displayName: 'Users',
    description: 'User management',
    isSystem: true,
    isOrphaned: false,
    actionNames: ['read', 'update'],
    conditionalActionNames: ['update'],
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
    actionNames: ['read'],
    conditionalActionNames: [],
    allowedActionNames: ['read'],
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
    actionNames: ['read'],
    conditionalActionNames: [],
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

    mockMetrics = { recordCacheAccess: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourceService,
        {
          provide: getRepositoryToken(Resource),
          useValue: mockResourceRepo
        },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: ResourceRegistryService, useValue: mockRegistry },
        { provide: MetricsService, useValue: mockMetrics }
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

      expect(mockCacheManager.del).toHaveBeenCalledWith('rbac:subject_map:v3');
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

  describe('update - offered actions', () => {
    it('rejects an action the resource does not declare', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });

      await expect(
        service.update('res-1', { allowedActionNames: ['read', 'delete'] })
      ).rejects.toMatchObject({
        response: { errorKey: 'errors.resources.actionNotDeclared' }
      });
      expect(mockResourceRepo.save).not.toHaveBeenCalled();
    });

    it('accepts a narrowing to declared actions and a reset to null', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      await service.update('res-1', { allowedActionNames: ['read'] });
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      await service.update('res-1', { allowedActionNames: null });

      expect(mockResourceRepo.save).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ allowedActionNames: ['read'] })
      );
      expect(mockResourceRepo.save).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ allowedActionNames: null })
      );
    });
  });

  describe('getSubjectMaps', () => {
    it('should return cached maps on cache hit', async () => {
      const cachedMaps = {
        active: { users: 'User', articles: 'Article' },
        orphaned: {}
      };
      mockCacheManager.get.mockResolvedValue(cachedMaps);

      const result = await service.getSubjectMaps();

      expect(result).toEqual(cachedMaps);
      expect(mockResourceRepo.find).not.toHaveBeenCalled();
      expect(mockMetrics.recordCacheAccess).toHaveBeenCalledWith(
        'resources',
        'hit'
      );
    });

    it('should build maps from DB on cache miss and store in cache', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockResourceRepo.find.mockResolvedValue([resource1, resource2]);

      const result = await service.getSubjectMaps();

      const expected = {
        active: { users: 'User', articles: 'Article' },
        orphaned: {},
        grantableActions: { users: ['read', 'update'], articles: ['read'] },
        conditionalActions: { users: ['update'], articles: [] }
      };
      expect(result).toEqual(expected);
      expect(mockResourceRepo.find).toHaveBeenCalled();
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'rbac:subject_map:v3',
        expected,
        300_000
      );
      expect(mockMetrics.recordCacheAccess).toHaveBeenCalledWith(
        'resources',
        'miss'
      );
    });

    it('offers only declared actions, whatever the admin narrowing names', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockResourceRepo.find.mockResolvedValue([
        { ...resource1, allowedActionNames: ['update', 'search'] }
      ]);

      const result = await service.getSubjectMaps();

      expect(result.grantableActions).toEqual({ users: ['update'] });
    });

    it('should keep orphaned resources out of the active map but expose them separately', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockResourceRepo.find.mockResolvedValue([resource1, orphanedResource]);

      const result = await service.getSubjectMaps();

      expect(result.active).toEqual({ users: 'User' });
      expect(result.active).not.toHaveProperty('legacy');
      expect(result.orphaned).toEqual({ legacy: 'Legacy' });
    });

    it('should return null from cache as a miss', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockResourceRepo.find.mockResolvedValue([]);

      const result = await service.getSubjectMaps();

      expect(result).toEqual({
        active: {},
        orphaned: {},
        grantableActions: {},
        conditionalActions: {}
      });
      expect(mockResourceRepo.find).toHaveBeenCalled();
    });

    it('should return empty maps when no resources exist', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockResourceRepo.find.mockResolvedValue([]);

      const result = await service.getSubjectMaps();

      expect(result).toEqual({
        active: {},
        orphaned: {},
        grantableActions: {},
        conditionalActions: {}
      });
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'rbac:subject_map:v3',
        {
          active: {},
          orphaned: {},
          grantableActions: {},
          conditionalActions: {}
        },
        300_000
      );
    });
  });

  describe('upsertResource', () => {
    const declared = { actionNames: ['read'], conditionalActionNames: [] };

    it('should update existing resource if found by name', async () => {
      const existing = { ...resource1 };
      mockResourceRepo.findOne.mockResolvedValue(existing);
      mockResourceRepo.save.mockImplementation(
        (data: Record<string, unknown>) => Promise.resolve(data)
      );

      const result = await service.upsertResource({
        ...declared,
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
        ...declared,
        name: 'users',
        subject: 'User',
        displayName: 'Users'
      });

      expect(existing.lastSyncedAt).toBeInstanceOf(Date);
    });

    it('rewrites the declared lists and keeps the admin narrowing', async () => {
      const existing = {
        ...resource1,
        actionNames: ['read'],
        conditionalActionNames: [],
        allowedActionNames: ['read']
      };
      mockResourceRepo.findOne.mockResolvedValue(existing);

      const result = await service.upsertResource({
        name: 'users',
        subject: 'User',
        displayName: 'Users',
        actionNames: ['read', 'update'],
        conditionalActionNames: ['update']
      });

      expect(result).toEqual(
        expect.objectContaining({
          actionNames: ['read', 'update'],
          conditionalActionNames: ['update'],
          allowedActionNames: ['read']
        })
      );
    });

    it('should create new resource if not found by name', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);

      const result = await service.upsertResource({
        ...declared,
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
        ...declared,
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
        ...declared,
        name: 'reports',
        subject: 'Report',
        displayName: 'Reports'
      });

      expect(mockResourceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ isSystem: false })
      );
    });

    it('should throw HttpException when subject is CASL reserved word "all"', async () => {
      await expect(
        service.upsertResource({
          ...declared,
          name: 'everything',
          subject: 'all',
          displayName: 'Everything'
        })
      ).rejects.toThrow(HttpException);
      expect(mockResourceRepo.findOne).not.toHaveBeenCalled();
    });

    it('should reject reserved subject even with mixed case', async () => {
      await expect(
        service.upsertResource({
          ...declared,
          name: 'everything',
          subject: 'ALL',
          displayName: 'Everything'
        })
      ).rejects.toThrow(HttpException);
    });

    it('should normalize lowercase subject to PascalCase when creating', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);

      await service.upsertResource({
        ...declared,
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
        ...declared,
        name: 'users',
        subject: 'user',
        displayName: 'Users'
      });

      expect(existing.subject).toBe('User');
    });

    it('should leave already-PascalCase subject unchanged', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);

      await service.upsertResource({
        ...declared,
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

      expect(mockCacheManager.del).toHaveBeenCalledWith('rbac:subject_map:v3');
    });

    it('should throw NotFoundException if resource not found', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);

      await expect(service.restore('bad-id')).rejects.toThrow(
        'Resource not found'
      );
    });

    it('should throw HttpException if controller is not registered', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });
      mockRegistry.isRegistered.mockReturnValue(false);

      await expect(service.restore('res-3')).rejects.toThrow(HttpException);
      expect(mockResourceRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('invalidateSubjectMapCache', () => {
    it('should delete the subject map cache entry', async () => {
      await service.invalidateSubjectMapCache();
      expect(mockCacheManager.del).toHaveBeenCalledWith('rbac:subject_map:v3');
    });
  });
});
