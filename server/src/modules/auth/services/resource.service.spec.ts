import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
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
    update: jest.Mock;
    findOneByOrFail: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let mockEm: { update: jest.Mock; findOneByOrFail: jest.Mock };
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
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      // The first resource with the columns of the last update applied.
      findOneByOrFail: jest.fn().mockImplementation(() =>
        Promise.resolve({
          ...resource1,
          ...((
            mockResourceRepo.update.mock.lastCall as unknown[] | undefined
          )?.[1] as Partial<Resource>)
        })
      ),
      manager: {
        transaction: jest.fn((work: (em: unknown) => Promise<unknown>) =>
          work(mockEm)
        )
      }
    };
    // The transactional writes go through the repository mock, so the
    // assertions on `update` below cover both paths.
    mockEm = {
      update: jest.fn(
        (_target: unknown, criteria: unknown, set: unknown): unknown =>
          mockResourceRepo.update(criteria, set)
      ),
      findOneByOrFail: jest.fn((_target: unknown, where: unknown): unknown =>
        mockResourceRepo.findOneByOrFail(where)
      )
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
      expect(mockResourceRepo.update).not.toHaveBeenCalled();
      expect(mockAudit.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'actor-1', targetId: 'res-2' })
      );
    });

    it('refuses an update that moves the record out of the grant', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });

      await expect(
        service.update('res-1', { displayName: 'Moved' }, scoped)
      ).rejects.toMatchObject(refused);
      expect(mockResourceRepo.update).not.toHaveBeenCalled();
    });

    it('accepts an update that keeps the record inside the grant', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });

      await service.update('res-1', { description: 'x' }, scoped);

      expect(mockResourceRepo.update).toHaveBeenCalled();
    });

    it('refuses a restore of a record outside the grant', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource2 });

      await expect(service.restore('res-2', scoped)).rejects.toMatchObject(
        refused
      );
      expect(mockResourceRepo.update).not.toHaveBeenCalled();
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
      expect(mockResourceRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update an existing resource', async () => {
      const updatedResource = { ...resource1, displayName: 'Updated Users' };
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });

      const result = await service.update(
        'res-1',
        {
          displayName: 'Updated Users'
        },
        superAbility
      );

      expect(result).toEqual(updatedResource);
      expect(mockResourceRepo.update).toHaveBeenCalled();
    });

    it('should throw Error if resource not found', async () => {
      mockResourceRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('bad-id', { displayName: 'Nope' }, superAbility)
      ).rejects.toThrow('Resource not found');
    });

    it('should invalidate subject map cache after update', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });

      await service.update('res-1', { description: 'New desc' }, superAbility);

      expectSubjectMapVersionBumped();
    });

    it('writes only the changed columns, keyed on the row', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });

      await service.update(
        'res-1',
        {
          displayName: 'New Name',
          description: null
        },
        superAbility
      );

      expect(mockResourceRepo.update).toHaveBeenCalledWith(
        { id: 'res-1' },
        { displayName: 'New Name', description: null }
      );
    });

    it('answers not found and writes no audit row when the row is gone', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      mockResourceRepo.update.mockResolvedValueOnce({ affected: 0 });

      await expect(
        service.update(
          'res-1',
          { description: 'x' },
          superAbility,
          undefined,
          () => ({ action: AuditAction.RESOURCE_UPDATE })
        )
      ).rejects.toMatchObject({
        response: { errorKey: 'errors.resources.notFound' }
      });
      expect(mockAudit.log).not.toHaveBeenCalled();
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });

    it('writes the audit row in the transaction of the write', async () => {
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

      expect(mockEm.update).toHaveBeenCalled();
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
      expect(mockResourceRepo.update).not.toHaveBeenCalled();
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

      expect(mockResourceRepo.update).toHaveBeenNthCalledWith(
        1,
        { id: 'res-1' },
        { allowedActionNames: ['read'] }
      );
      expect(mockResourceRepo.update).toHaveBeenNthCalledWith(
        2,
        { id: 'res-1' },
        { allowedActionNames: null }
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
        mockResourceRepo.update.mockImplementationOnce(() => {
          expect(emitted()).toHaveLength(0);
          return Promise.resolve({ affected: 1 });
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

      expect(mockResourceRepo.update).toHaveBeenCalledTimes(3);
      expect(emitted()).toHaveLength(0);
    });

    it('emits nothing when the write fails', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      mockResourceRepo.update.mockRejectedValueOnce(new Error('db down'));

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
      mockResourceRepo.findOne.mockResolvedValue({
        ...orphanedResource,
        allowedActionNames: []
      });
      await service.restore('res-3', superAbility);

      expect(mockEm.update).toHaveBeenCalledTimes(1);
      expect(emitted()).toHaveLength(0);
    });

    it('emits nothing after a restore that a concurrent restore won', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });
      mockEm.update.mockResolvedValueOnce({ affected: 0 });

      await expect(service.restore('res-3', superAbility)).rejects.toThrow(
        HttpException
      );
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
        expect(mockResourceRepo.update).not.toHaveBeenCalled();
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

      expect(mockResourceRepo.update).toHaveBeenCalledTimes(3);
      expect(mockAudit.logFireAndForget).not.toHaveBeenCalled();
    });

    it('lets a super caller widen', async () => {
      mockResourceRepo.findOne.mockResolvedValue(narrowed());

      await service.update('res-1', { allowedActionNames: null }, superAbility);

      expect(mockResourceRepo.update).toHaveBeenCalledWith(
        { id: 'res-1' },
        { allowedActionNames: null }
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

    const syncWrite = () =>
      mockResourceRepo.update.mock.calls[0] as [
        { id: string },
        Partial<Resource>
      ];

    it('fills the description only where it is empty', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });

      await service.upsertResource({
        ...declared,
        name: 'users',
        subject: 'User',
        displayName: 'Users'
      });

      expect(syncWrite()[1]).not.toHaveProperty('description');
      expect(mockResourceRepo.update).toHaveBeenCalledWith(
        { id: 'res-1', description: IsNull() },
        { description: 'Declared description' }
      );
    });

    it('writes only the declared columns of the existing resource found by name', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });

      await service.upsertResource({
        ...declared,
        name: 'users',
        subject: 'UpdatedUser',
        displayName: 'Updated Users'
      });

      expect(syncWrite()).toEqual([
        { id: 'res-1' },
        {
          subject: 'UpdatedUser',
          actionNames: ['read'],
          conditionalActionNames: [],
          lastSyncedAt: expect.any(Date) as Date
        }
      ]);
      expect(mockResourceRepo.findOne).toHaveBeenCalledWith({
        where: { name: 'users' }
      });
      expect(mockResourceRepo.create).not.toHaveBeenCalled();
      expect(mockResourceRepo.save).not.toHaveBeenCalled();
    });

    it('returns the row read again after the write', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      const reread = { ...resource1, displayName: 'Edited by an admin' };
      mockResourceRepo.findOneByOrFail.mockResolvedValue(reread);

      const result = await service.upsertResource({
        ...declared,
        name: 'users',
        subject: 'User',
        displayName: 'Users'
      });

      expect(mockResourceRepo.findOneByOrFail).toHaveBeenCalledWith({
        id: 'res-1'
      });
      expect(result).toBe(reread);
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
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });

      await service.upsertResource({
        ...declared,
        name: 'users',
        subject: 'user',
        displayName: 'Users'
      });

      expect(syncWrite()[1]).toMatchObject({ subject: 'User' });
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
    it('clears isOrphaned only on a row that is still orphaned', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });

      const result = await service.restore('res-3', superAbility);

      expect(result).toMatchObject({ isOrphaned: false });
      expect(mockEm.update).toHaveBeenCalledWith(
        Resource,
        { id: 'res-3', isOrphaned: true },
        { isOrphaned: false }
      );
    });

    it('should set isRegistered to true on returned resource', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });

      const result = await service.restore('res-3', superAbility);

      expect(result.isRegistered).toBe(true);
    });

    it('writes the audit row in the transaction of the write', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });
      const audit = {
        action: AuditAction.RESOURCE_RESTORE,
        targetId: 'res-3',
        targetType: 'Resource'
      };

      await service.restore('res-3', superAbility, undefined, audit);

      expect(mockEm.update).toHaveBeenCalledTimes(1);
      expect(mockAudit.log).toHaveBeenCalledWith(audit, mockEm);
    });

    it('refuses a resource that is not orphaned, before any effect', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...resource1 });
      const audit = {
        action: AuditAction.RESOURCE_RESTORE,
        targetId: 'res-1',
        targetType: 'Resource'
      };

      await expect(
        service.restore('res-1', superAbility, undefined, audit)
      ).rejects.toMatchObject({
        status: 409,
        response: { errorKey: 'errors.resources.notOrphaned' }
      });
      expect(mockResourceRepo.manager.transaction).not.toHaveBeenCalled();
      expect(mockAudit.log).not.toHaveBeenCalled();
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });

    it('refuses the loser of two concurrent restores and writes no audit row', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });
      mockEm.update.mockResolvedValueOnce({ affected: 0 });
      const audit = {
        action: AuditAction.RESOURCE_RESTORE,
        targetId: 'res-3',
        targetType: 'Resource'
      };

      await expect(
        service.restore('res-3', superAbility, undefined, audit)
      ).rejects.toMatchObject({
        status: 409,
        response: { errorKey: 'errors.resources.notOrphaned' }
      });
      expect(mockAudit.log).not.toHaveBeenCalled();
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });

    it('should invalidate subject map cache after restore', async () => {
      mockResourceRepo.findOne.mockResolvedValue({ ...orphanedResource });

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
      expect(mockEm.update).not.toHaveBeenCalled();
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
      mockResourceRepo.findOne.mockResolvedValue({
        ...orphanedResource,
        allowedActionNames: []
      });
      await service.restore('res-3', delegatedAbility);

      expect(mockEm.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidateSubjectMapCache', () => {
    it('bumps the subject map version instead of deleting the entry', async () => {
      await service.invalidateSubjectMapCache();
      expectSubjectMapVersionBumped();
    });
  });
});
