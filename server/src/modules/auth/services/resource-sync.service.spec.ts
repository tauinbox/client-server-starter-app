import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { ResourceSyncService } from './resource-sync.service';
import { ResourceService } from './resource.service';
import { Resource } from '../entities/resource.entity';
import { Permission } from '../entities/permission.entity';
import { Action } from '../entities/action.entity';
import { RESOURCE_METADATA_KEY } from '../decorators/register-resource.decorator';

function makeController(ctrlName: string) {
  class Ctrl {}
  Object.defineProperty(Ctrl, 'name', { value: ctrlName, configurable: true });
  return { metatype: Ctrl };
}

describe('ResourceSyncService', () => {
  let service: ResourceSyncService;
  let discoveryServiceMock: { getControllers: jest.Mock };
  let reflectorMock: { get: jest.Mock };
  let resourceServiceMock: {
    upsertResource: jest.Mock;
    invalidateSubjectMapCache: jest.Mock;
  };
  let resourceRepoMock: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let permissionRepoMock: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let actionRepoMock: { find: jest.Mock };

  const usersMeta = { name: 'users', subject: 'User', displayName: 'Users' };
  const rolesMeta = { name: 'roles', subject: 'Role', displayName: 'Roles' };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();

    discoveryServiceMock = { getControllers: jest.fn().mockReturnValue([]) };

    reflectorMock = { get: jest.fn().mockReturnValue(undefined) };

    resourceServiceMock = {
      upsertResource: jest.fn().mockResolvedValue({ id: 'res-1' }),
      invalidateSubjectMapCache: jest.fn().mockResolvedValue(undefined)
    };

    resourceRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined)
    };

    permissionRepoMock = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((data: object) => data),
      save: jest.fn().mockResolvedValue(undefined)
    };

    actionRepoMock = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourceSyncService,
        { provide: DiscoveryService, useValue: discoveryServiceMock },
        { provide: Reflector, useValue: reflectorMock },
        { provide: ResourceService, useValue: resourceServiceMock },
        { provide: getRepositoryToken(Resource), useValue: resourceRepoMock },
        {
          provide: getRepositoryToken(Permission),
          useValue: permissionRepoMock
        },
        { provide: getRepositoryToken(Action), useValue: actionRepoMock }
      ]
    }).compile();

    service = module.get<ResourceSyncService>(ResourceSyncService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── onApplicationBootstrap ────────────────────────────────────────

  describe('onApplicationBootstrap', () => {
    it('should call syncResources on startup', async () => {
      await service.onApplicationBootstrap();

      expect(resourceServiceMock.invalidateSubjectMapCache).toHaveBeenCalled();
    });

    it('should catch errors and log warning instead of crashing', async () => {
      discoveryServiceMock.getControllers.mockImplementation(() => {
        throw new Error('Table does not exist');
      });
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      await expect(service.onApplicationBootstrap()).resolves.not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Resource sync skipped'),
        expect.any(String)
      );
    });

    it('should handle non-Error throws gracefully', async () => {
      discoveryServiceMock.getControllers.mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'string error';
      });

      await expect(service.onApplicationBootstrap()).resolves.not.toThrow();
    });
  });

  // ── syncResources — controller discovery ─────────────────────────

  describe('syncResources — controller discovery', () => {
    it('should skip controllers without metatype', async () => {
      discoveryServiceMock.getControllers.mockReturnValue([
        { metatype: undefined },
        { metatype: null }
      ]);

      await service.onApplicationBootstrap();

      expect(resourceServiceMock.upsertResource).not.toHaveBeenCalled();
    });

    it('should skip controllers without @RegisterResource decorator (non-Health/Auth/OAuth)', async () => {
      const ctrl = makeController('UsersController');
      discoveryServiceMock.getControllers.mockReturnValue([ctrl]);
      reflectorMock.get.mockReturnValue(undefined);

      await service.onApplicationBootstrap();

      expect(resourceServiceMock.upsertResource).not.toHaveBeenCalled();
    });

    it('should not log debug for Health/Auth/OAuth controllers without decorator', async () => {
      const healthCtrl = makeController('HealthController');
      const authCtrl = makeController('AuthController');
      const oauthCtrl = makeController('OAuthController');
      discoveryServiceMock.getControllers.mockReturnValue([
        healthCtrl,
        authCtrl,
        oauthCtrl
      ]);
      reflectorMock.get.mockReturnValue(undefined);
      const debugSpy = jest.spyOn(Logger.prototype, 'debug');

      await service.onApplicationBootstrap();

      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('should log debug for undecorated non-system controllers', async () => {
      const ctrl = makeController('ReportController');
      discoveryServiceMock.getControllers.mockReturnValue([ctrl]);
      reflectorMock.get.mockReturnValue(undefined);
      const debugSpy = jest.spyOn(Logger.prototype, 'debug');

      await service.onApplicationBootstrap();

      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('ReportController')
      );
    });
  });

  // ── syncResources — upsert & permissions ─────────────────────────

  describe('syncResources — upsert and permission creation', () => {
    it('should upsert resource with isSystem:true for decorated controller', async () => {
      const ctrl = makeController('RbacController');
      discoveryServiceMock.getControllers.mockReturnValue([ctrl]);
      reflectorMock.get.mockImplementation((key: string) => {
        if (key === RESOURCE_METADATA_KEY) return usersMeta;
        return undefined;
      });

      await service.onApplicationBootstrap();

      expect(resourceServiceMock.upsertResource).toHaveBeenCalledWith({
        name: 'users',
        subject: 'User',
        displayName: 'Users',
        isSystem: true
      });
    });

    it('should auto-create permissions for each resource × action pair', async () => {
      const ctrl = makeController('RbacController');
      discoveryServiceMock.getControllers.mockReturnValue([ctrl]);
      reflectorMock.get.mockReturnValue(usersMeta);
      resourceServiceMock.upsertResource.mockResolvedValue({ id: 'res-1' });
      actionRepoMock.find.mockResolvedValue([
        { id: 'act-read', name: 'read' },
        { id: 'act-write', name: 'write' }
      ]);
      permissionRepoMock.findOne.mockResolvedValue(null);

      await service.onApplicationBootstrap();

      expect(permissionRepoMock.create).toHaveBeenCalledTimes(2);
      expect(permissionRepoMock.create).toHaveBeenCalledWith({
        resourceId: 'res-1',
        actionId: 'act-read'
      });
      expect(permissionRepoMock.create).toHaveBeenCalledWith({
        resourceId: 'res-1',
        actionId: 'act-write'
      });
      expect(permissionRepoMock.save).toHaveBeenCalledTimes(2);
    });

    it('should not create permission if it already exists', async () => {
      const ctrl = makeController('RbacController');
      discoveryServiceMock.getControllers.mockReturnValue([ctrl]);
      reflectorMock.get.mockReturnValue(usersMeta);
      resourceServiceMock.upsertResource.mockResolvedValue({ id: 'res-1' });
      actionRepoMock.find.mockResolvedValue([{ id: 'act-1', name: 'read' }]);
      permissionRepoMock.findOne.mockResolvedValue({ id: 'perm-1' });

      await service.onApplicationBootstrap();

      expect(permissionRepoMock.create).not.toHaveBeenCalled();
      expect(permissionRepoMock.save).not.toHaveBeenCalled();
    });

    it('should not create permissions when no actions exist', async () => {
      const ctrl = makeController('RbacController');
      discoveryServiceMock.getControllers.mockReturnValue([ctrl]);
      reflectorMock.get.mockReturnValue(usersMeta);
      actionRepoMock.find.mockResolvedValue([]);

      await service.onApplicationBootstrap();

      expect(permissionRepoMock.create).not.toHaveBeenCalled();
    });

    it('should deduplicate controllers with the same resource name', async () => {
      const ctrl1 = makeController('ControllerA');
      const ctrl2 = makeController('ControllerB');
      discoveryServiceMock.getControllers.mockReturnValue([ctrl1, ctrl2]);
      // Both controllers claim the same resource name
      reflectorMock.get.mockReturnValue(usersMeta);

      await service.onApplicationBootstrap();

      expect(resourceServiceMock.upsertResource).toHaveBeenCalledTimes(1);
    });

    it('should process multiple distinct resources', async () => {
      const ctrl1 = makeController('UsersController');
      const ctrl2 = makeController('RolesController');
      discoveryServiceMock.getControllers.mockReturnValue([ctrl1, ctrl2]);
      reflectorMock.get.mockImplementation(
        (_key: string, target: { name: string }) => {
          if (target.name === 'UsersController') return usersMeta;
          if (target.name === 'RolesController') return rolesMeta;
          return undefined;
        }
      );

      await service.onApplicationBootstrap();

      expect(resourceServiceMock.upsertResource).toHaveBeenCalledTimes(2);
      expect(resourceServiceMock.upsertResource).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'users' })
      );
      expect(resourceServiceMock.upsertResource).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'roles' })
      );
    });
  });

  // ── syncResources — subject casing ───────────────────────────────

  describe('syncResources — subject casing', () => {
    it('should warn when subject does not start with uppercase', async () => {
      const ctrl = makeController('PostsController');
      discoveryServiceMock.getControllers.mockReturnValue([ctrl]);
      reflectorMock.get.mockReturnValue({
        name: 'posts',
        subject: 'post',
        displayName: 'Posts'
      });
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      await service.onApplicationBootstrap();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"post"'));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('PostsController')
      );
    });

    it('should not warn when subject is already PascalCase', async () => {
      const ctrl = makeController('UsersController');
      discoveryServiceMock.getControllers.mockReturnValue([ctrl]);
      reflectorMock.get.mockReturnValue(usersMeta);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      await service.onApplicationBootstrap();

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // ── syncResources — orphan detection ─────────────────────────────

  describe('syncResources — orphaned resource detection', () => {
    it('should mark resource as orphaned and warn when not registered', async () => {
      discoveryServiceMock.getControllers.mockReturnValue([]);
      const legacy = { id: 'old-res', name: 'legacy', isOrphaned: false };
      resourceRepoMock.find.mockResolvedValue([legacy]);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      await service.onApplicationBootstrap();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"legacy"'));
      expect(resourceRepoMock.save).toHaveBeenCalledWith(
        expect.objectContaining({ isOrphaned: true })
      );
    });

    it('should warn (without save) when resource was already orphaned', async () => {
      discoveryServiceMock.getControllers.mockReturnValue([]);
      resourceRepoMock.find.mockResolvedValue([
        { id: 'old-res', name: 'legacy', isOrphaned: true }
      ]);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      await service.onApplicationBootstrap();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"legacy"'));
      expect(resourceRepoMock.save).not.toHaveBeenCalled();
    });

    it('should not warn for resources that are registered', async () => {
      const ctrl = makeController('UsersController');
      discoveryServiceMock.getControllers.mockReturnValue([ctrl]);
      reflectorMock.get.mockReturnValue(usersMeta);
      resourceRepoMock.find.mockResolvedValue([
        { id: 'res-1', name: 'users', isOrphaned: false }
      ]);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      await service.onApplicationBootstrap();

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // ── syncResources — cache invalidation ───────────────────────────

  describe('syncResources — cache invalidation', () => {
    it('should invalidate subject map cache after sync', async () => {
      await service.onApplicationBootstrap();

      expect(
        resourceServiceMock.invalidateSubjectMapCache
      ).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache even when no controllers are registered', async () => {
      discoveryServiceMock.getControllers.mockReturnValue([]);

      await service.onApplicationBootstrap();

      expect(resourceServiceMock.invalidateSubjectMapCache).toHaveBeenCalled();
    });
  });
});
