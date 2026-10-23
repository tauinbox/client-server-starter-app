import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ResourceService } from './resource.service';
import { ResourceActionsChangedEvent } from '../events/resource-actions-changed.event';
import { ResourceRegistryService } from './resource-registry.service';
import { Resource } from '../entities/resource.entity';
import { MetricsService } from '../../core/metrics/metrics.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { bindAuditContext } from '../casl/ability-context';
import {
  AbilityBuilder,
  createMongoAbility,
  type AppAbility
} from '../casl/app-ability';

function abilityWith(define: (can: AbilityBuilder<AppAbility>['can']) => void) {
  const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
  define(builder.can);
  return builder.build();
}

const superAbility = abilityWith((can) => can('manage', 'all'));
// Even an unconditional allow on the woken action does not let a non-super
// caller widen: the check is on the caller being super.
const delegatedAbility = abilityWith((can) => {
  can('update', 'Permission');
  can('read', 'User');
  can('update', 'User');
});

describe('ResourceService', () => {
  let service: ResourceService;
  let mockResourceRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let mockEm: { save: jest.Mock };
  let mockAudit: { log: jest.Mock; logFireAndForget: jest.Mock };
  let mockCacheManager: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };
  let mockRegistry: {
    isRegistered: jest.Mock;
    register: jest.Mock;
  };
  let mockMetrics: {
    recordCacheAccess: jest.Mock;
    recordPermissionDenied: jest.Mock;
  };
  let mockEventEmitter: { emit: jest.Mock<boolean, [string, unknown]> };

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

  function expectSubjectMapVersionBumped(): void {
    expect(mockCacheManager.set).toHaveBeenCalledWith(
      'rbac:subject_map:version',
      expect.any(Number),
      0
    );
    expect(mockCacheManager.del).not.toHaveBeenCalled();
  }

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
        ),
      manager: {
        transaction: jest.fn((work: (em: unknown) => Promise<unknown>) =>
          work(mockEm)
        )
      }
    };
    // The transactional save goes through the repository mock, so the
    // assertions on `save` below cover both paths.
    mockEm = {
      save: jest.fn((data: unknown): unknown => mockResourceRepo.save(data))
    };
    mockAudit = {
      log: jest.fn().mockResolvedValue(undefined),
      logFireAndForget: jest.fn()
    };

    mockCacheManager = {
      get: jest.fn((key: string) =>
        Promise.resolve(key === 'rbac:subject_map:version' ? 4 : undefined)
      ),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined)
    };

    mockRegistry = {
      isRegistered: jest.fn().mockReturnValue(true),
      register: jest.fn()
    };

    mockMetrics = {
      recordCacheAccess: jest.fn(),
      recordPermissionDenied: jest.fn()
    };

    mockEventEmitter = { emit: jest.fn<boolean, [string, unknown]>() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourceService,
        {
          provide: getRepositoryToken(Resource),
          useValue: mockResourceRepo
        },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: ResourceRegistryService, useValue: mockRegistry },
        { provide: MetricsService, useValue: mockMetrics },
        { provide: AuditService, useValue: mockAudit },
        { provide: EventEmitter2, useValue: mockEventEmitter }
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

  describe('instance check of update:Permission', () => {
    const scoped = abilityWith((can) =>
      can('update', 'Permission', { displayName: { $in: ['Users'] } })
    );
    const refused = {
      status: 403,
      response: { errorKey: 'errors.general.insufficientPermissions' }
    };

    it('refuses an update of a record outside the grant', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource2 });

      await expect(
        service.update('res-2', { description: 'x' }, scoped, 'actor-1')
      ).rejects.toMatchObject(refused);
      expect(mockResourceRepo.save).not.toHaveBeenCalled();
      expect(mockAudit.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'actor-1', targetId: 'res-2' })
      );
    });

    it('refuses an update that moves the record out of the grant', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });

      await expect(
        service.update('res-1', { displayName: 'Moved' }, scoped)
      ).rejects.toMatchObject(refused);
      expect(mockResourceRepo.save).not.toHaveBeenCalled();
    });

    it('accepts an update that keeps the record inside the grant', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });

      await service.update('res-1', { description: 'x' }, scoped);

      expect(mockResourceRepo.save).toHaveBeenCalled();
    });

    it('refuses a restore of a record outside the grant', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource2 });

      await expect(service.restore('res-2', scoped)).rejects.toMatchObject(
        refused
      );
      expect(mockResourceRepo.save).not.toHaveBeenCalled();
    });

    it('answers 404 before the check', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);

      await expect(service.restore('bad-id', scoped)).rejects.toMatchObject({
        status: 404
      });
      expect(mockAudit.logFireAndForget).not.toHaveBeenCalled();
    });

    it('requires the ability argument and fails closed without it', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      await expect(
        // @ts-expect-error the ability is required: a skipped check is written as SYSTEM_ABILITY
        service.update('res-1', { description: 'x' })
      ).rejects.toThrow(TypeError);
      expect(mockResourceRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update an existing resource', async () => {
      const updatedResource = { ...resource1, displayName: 'Updated Users' };
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      mockResourceRepo.save.mockResolvedValue(updatedResource);

      const result = await service.update(
        'res-1',
        {
          displayName: 'Updated Users'
        },
        superAbility
      );

      expect(result).toEqual(updatedResource);
      expect(mockResourceRepo.save).toHaveBeenCalled();
    });

    it('should throw Error if resource not found', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('bad-id', { displayName: 'Nope' }, superAbility)
      ).rejects.toThrow('Resource not found');
    });

    it('should invalidate subject map cache after update', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      mockResourceRepo.save.mockResolvedValue(resource1);

      await service.update('res-1', { description: 'New desc' }, superAbility);

      expectSubjectMapVersionBumped();
    });

    it('should apply partial update data via Object.assign', async () => {
      const original = { ...resource1 };
      mockResourceRepo.findOne.mockResolvedValue(original);
      mockResourceRepo.save.mockImplementation(
        (data: Record<string, unknown>) => Promise.resolve(data)
      );

      await service.update(
        'res-1',
        {
          displayName: 'New Name',
          description: null
        },
        superAbility
      );

      expect(mockResourceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'New Name',
          description: null
        })
      );
    });

    it('writes the audit row in the transaction of the save', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      const audit = {
        action: AuditAction.RESOURCE_UPDATE,
        targetId: 'res-1',
        targetType: 'Resource'
      };

      await service.update(
        'res-1',
        { displayName: 'Audited' },
        superAbility,
        undefined,
        () => audit
      );

      expect(mockEm.save).toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(audit, mockEm);
    });

    it('fails and leaves the cache when the audit row fails', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      mockAudit.log.mockRejectedValue(new Error('audit down'));

      await expect(
        service.update(
          'res-1',
          { displayName: 'Audited' },
          superAbility,
          undefined,
          () => ({ action: AuditAction.RESOURCE_UPDATE })
        )
      ).rejects.toThrow('audit down');
      expect(mockCacheManager.del).not.toHaveBeenCalled();
    });

    it('writes no audit row without audit params', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });

      await service.update('res-1', { displayName: 'Plain' }, superAbility);

      expect(mockAudit.log).not.toHaveBeenCalled();
    });
  });

  describe('update - offered actions', () => {
    it('rejects an action the resource does not declare', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });

      await expect(
        service.update(
          'res-1',
          { allowedActionNames: ['read', 'delete'] },
          superAbility
        )
      ).rejects.toMatchObject({
        response: { errorKey: 'errors.resources.actionNotDeclared' }
      });
      expect(mockResourceRepo.save).not.toHaveBeenCalled();
    });

    it('accepts a narrowing to declared actions and a reset to null', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      await service.update(
        'res-1',
        { allowedActionNames: ['read'] },
        superAbility
      );
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      await service.update('res-1', { allowedActionNames: null }, superAbility);

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

  describe('push of a change of the grantable actions', () => {
    const emitted = () =>
      mockEventEmitter.emit.mock.calls.filter(
        ([name]) => name === ResourceActionsChangedEvent.name
      );

    it('emits once after a narrowing, a widening and a reset to null are committed', async () => {
      const writes: [string[] | null, string[] | null][] = [
        [null, ['read']],
        [['read'], ['read', 'update']],
        [['read'], null]
      ];
      for (const [before, allowedActionNames] of writes) {
        mockResourceRepo.findOne.mockResolvedValue({
          ...resource1,
          allowedActionNames: before
        });
        mockEventEmitter.emit.mockClear();
        mockResourceRepo.save.mockImplementationOnce((data: unknown) => {
          expect(emitted()).toHaveLength(0);
          return Promise.resolve(data);
        });

        await service.update('res-1', { allowedActionNames }, superAbility);

        expect(emitted()).toHaveLength(1);
      }
    });

    it('emits nothing when the grantable actions stay the same', async () => {
      const writes = [
        { displayName: 'Members' },
        { allowedActionNames: ['update', 'read'] },
        { allowedActionNames: null }
      ];
      for (const data of writes) {
        mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
        await service.update('res-1', data, superAbility);
      }

      expect(mockResourceRepo.save).toHaveBeenCalledTimes(3);
      expect(emitted()).toHaveLength(0);
    });

    it('emits nothing when the write fails', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      mockResourceRepo.save.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.update('res-1', { allowedActionNames: ['read'] }, superAbility)
      ).rejects.toThrow('db down');
      expect(emitted()).toHaveLength(0);
    });

    it('emits once after the restore of an orphaned resource that wakes a grant', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });

      await service.restore('res-3', superAbility);

      expect(emitted()).toHaveLength(1);
    });

    it('emits nothing after a restore that wakes no grant', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      await service.restore('res-1', superAbility);
      mockResourceRepo.findOne.mockResolvedValue({
        ...orphanedResource,
        allowedActionNames: []
      });
      await service.restore('res-3', superAbility);

      expect(mockResourceRepo.save).toHaveBeenCalledTimes(2);
      expect(emitted()).toHaveLength(0);
    });
  });

  describe('update - offering an action again', () => {
    const narrowed = (): Resource => ({
      ...resource1,
      allowedActionNames: ['read']
    });
    const widenRefused = {
      status: 403,
      response: { errorKey: 'errors.resources.cannotWiden' }
    };

    it.each([
      ['a larger list', ['read', 'update']],
      ['null', null]
    ])(
      'refuses a non-super caller widening to %s',
      async (_label, allowedActionNames) => {
        mockResourceRepo.findOne.mockResolvedValue(narrowed());

        await expect(
          service.update(
            'res-1',
            { allowedActionNames },
            delegatedAbility,
            'actor-1',
            () => ({ action: AuditAction.RESOURCE_UPDATE, actorId: 'actor-1' })
          )
        ).rejects.toMatchObject(widenRefused);
        expect(mockResourceRepo.save).not.toHaveBeenCalled();
        expect(mockCacheManager.del).not.toHaveBeenCalled();
        expect(mockAudit.logFireAndForget).toHaveBeenCalledWith({
          action: AuditAction.PERMISSION_GRANT_DENIED,
          actorId: 'actor-1',
          targetId: 'res-1',
          targetType: 'Resource',
          details: {
            subject: 'User',
            actions: ['update'],
            reason: 'resource-widen'
          }
        });
        expect(mockMetrics.recordPermissionDenied).toHaveBeenCalledWith(
          'instance',
          'update',
          'User'
        );
      }
    );

    it('writes the request context of the refused caller', async () => {
      mockResourceRepo.findOne.mockResolvedValue(narrowed());
      const ability = abilityWith((can) => {
        can('update', 'Permission');
      });
      bindAuditContext(ability, { ip: '203.0.113.7', requestId: 'req-1' });

      await expect(
        service.update(
          'res-1',
          { allowedActionNames: null },
          ability,
          'actor-1'
        )
      ).rejects.toMatchObject(widenRefused);
      expect(mockAudit.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PERMISSION_GRANT_DENIED,
          context: { ip: '203.0.113.7', requestId: 'req-1' }
        })
      );
    });

    it('lets a non-super caller narrow, keep the set, or edit other fields', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      await service.update(
        'res-1',
        { allowedActionNames: ['read'] },
        delegatedAbility
      );
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      await service.update(
        'res-1',
        { allowedActionNames: ['update', 'read'] },
        delegatedAbility
      );
      mockResourceRepo.findOne.mockResolvedValue(narrowed());
      await service.update(
        'res-1',
        { displayName: 'Renamed' },
        delegatedAbility
      );

      expect(mockResourceRepo.save).toHaveBeenCalledTimes(3);
      expect(mockAudit.logFireAndForget).not.toHaveBeenCalled();
    });

    it('lets a super caller widen', async () => {
      mockResourceRepo.findOne.mockResolvedValue(narrowed());

      await service.update('res-1', { allowedActionNames: null }, superAbility);

      expect(mockResourceRepo.save).toHaveBeenCalledWith(
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
        'rbac:subject_map:v3:v4',
        expected,
        300_000
      );
      expect(mockMetrics.recordCacheAccess).toHaveBeenCalledWith(
        'resources',
        'miss'
      );
    });

    it('offers only declared actions, whatever the admin narrowing names', async () => {
      mockResourceRepo.find.mockResolvedValue([
        { ...resource1, allowedActionNames: ['update', 'search'] }
      ]);

      const result = await service.getSubjectMaps();

      expect(result.grantableActions).toEqual({ users: ['update'] });
    });

    it('should keep orphaned resources out of the active map but expose them separately', async () => {
      mockResourceRepo.find.mockResolvedValue([resource1, orphanedResource]);

      const result = await service.getSubjectMaps();

      expect(result.active).toEqual({ users: 'User' });
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
      mockResourceRepo.find.mockResolvedValue([]);

      const result = await service.getSubjectMaps();

      expect(result).toEqual({
        active: {},
        orphaned: {},
        grantableActions: {},
        conditionalActions: {}
      });
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'rbac:subject_map:v3:v4',
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
    const declared = {
      description: 'Declared description',
      actionNames: ['read'],
      conditionalActionNames: []
    };

    it('fills an empty description and keeps a stored one', async () => {
      mockResourceRepo.save.mockImplementation(
        (data: Record<string, unknown>) => Promise.resolve(data)
      );
      const empty = { ...resource1, description: null };
      mockResourceRepo.findOne.mockResolvedValue(empty);
      await service.upsertResource({
        ...declared,
        name: 'users',
        subject: 'User',
        displayName: 'Users'
      });
      expect(empty.description).toBe('Declared description');

      const edited = { ...resource1, description: 'Edited by an admin' };
      mockResourceRepo.findOne.mockResolvedValue(edited);
      await service.upsertResource({
        ...declared,
        name: 'users',
        subject: 'User',
        displayName: 'Users'
      });
      expect(edited.description).toBe('Edited by an admin');
    });

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
        description: 'User management',
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

      const result = await service.restore('res-3', superAbility);

      expect(result).toMatchObject({ isOrphaned: false });
      expect(mockResourceRepo.save).toHaveBeenCalled();
    });

    it('should set isRegistered to true on returned resource', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });
      mockResourceRepo.save.mockImplementation(
        (data: Record<string, unknown>) => Promise.resolve(data)
      );

      const result = await service.restore('res-3', superAbility);

      expect(result.isRegistered).toBe(true);
    });

    it('writes the audit row in the transaction of the save', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });
      const audit = {
        action: AuditAction.RESOURCE_RESTORE,
        targetId: 'res-3',
        targetType: 'Resource'
      };

      await service.restore('res-3', superAbility, undefined, audit);

      expect(mockEm.save).toHaveBeenCalledWith(
        expect.objectContaining({ isOrphaned: false })
      );
      expect(mockAudit.log).toHaveBeenCalledWith(audit, mockEm);
    });

    it('should invalidate subject map cache after restore', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });
      mockResourceRepo.save.mockImplementation(
        (data: Record<string, unknown>) => Promise.resolve(data)
      );

      await service.restore('res-3', superAbility);

      expectSubjectMapVersionBumped();
    });

    it('should throw NotFoundException if resource not found', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);

      await expect(service.restore('bad-id', superAbility)).rejects.toThrow(
        'Resource not found'
      );
    });

    it('should throw HttpException if controller is not registered', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });
      mockRegistry.isRegistered.mockReturnValue(false);

      await expect(service.restore('res-3', superAbility)).rejects.toThrow(
        HttpException
      );
      expect(mockResourceRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('restore - waking the grants of an orphaned resource', () => {
    it('refuses a non-super caller', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });

      await expect(
        service.restore('res-3', delegatedAbility)
      ).rejects.toMatchObject({
        status: 403,
        response: { errorKey: 'errors.resources.cannotWiden' }
      });
      expect(mockResourceRepo.save).not.toHaveBeenCalled();
      expect(mockAudit.logFireAndForget).toHaveBeenCalledWith({
        action: AuditAction.PERMISSION_GRANT_DENIED,
        actorId: null,
        targetId: 'res-3',
        targetType: 'Resource',
        details: {
          subject: 'Legacy',
          actions: ['read'],
          reason: 'resource-widen'
        }
      });
    });

    it('lets a non-super caller restore what wakes no grant', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      await service.restore('res-1', delegatedAbility);
      mockResourceRepo.findOne.mockResolvedValue({
        ...orphanedResource,
        allowedActionNames: []
      });
      await service.restore('res-3', delegatedAbility);

      expect(mockResourceRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidateSubjectMapCache', () => {
    it('bumps the subject map version instead of deleting the entry', async () => {
      await service.invalidateSubjectMapCache();
      expectSubjectMapVersionBumped();
    });
  });
});
