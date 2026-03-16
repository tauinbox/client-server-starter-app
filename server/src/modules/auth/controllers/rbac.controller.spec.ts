import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Logger } from '@nestjs/common';
import { RbacController } from './rbac.controller';
import { ResourceService } from '../services/resource.service';
import { ActionService } from '../services/action.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { JwtAuthRequest } from '../types/auth.request';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';

const allowAllGuard = { canActivate: () => true };

function mockJwtRequest(
  userId = 'user-1',
  email = 'admin@example.com'
): {
  user: JwtAuthRequest['user'];
  ip: string;
  headers: Record<string, string>;
} {
  return {
    user: { userId, email, roles: [] },
    ip: '127.0.0.1',
    headers: {}
  };
}

describe('RbacController', () => {
  let controller: RbacController;
  let resourceServiceMock: {
    findAll: jest.Mock;
    update: jest.Mock;
  };
  let actionServiceMock: {
    findAll: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let auditServiceMock: {
    log: jest.Mock;
  };
  let cacheManagerMock: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    resourceServiceMock = {
      findAll: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'res-1' })
    };

    actionServiceMock = {
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'act-1', name: 'export' }),
      update: jest.fn().mockResolvedValue({ id: 'act-1' }),
      delete: jest.fn().mockResolvedValue(undefined)
    };

    auditServiceMock = {
      log: jest.fn().mockResolvedValue(undefined)
    };

    cacheManagerMock = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined)
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RbacController],
      providers: [
        { provide: ResourceService, useValue: resourceServiceMock },
        { provide: ActionService, useValue: actionServiceMock },
        { provide: AuditService, useValue: auditServiceMock },
        { provide: CACHE_MANAGER, useValue: cacheManagerMock }
      ]
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowAllGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(allowAllGuard)
      .compile();

    controller = module.get<RbacController>(RbacController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── getMetadata ──────────────────────────────────────────────────

  describe('getMetadata', () => {
    it('should return cached value without fetching services', async () => {
      const cached = { resources: [], actions: [] };
      cacheManagerMock.get.mockResolvedValue(cached);

      const result = await controller.getMetadata();

      expect(result).toBe(cached);
      expect(resourceServiceMock.findAll).not.toHaveBeenCalled();
      expect(actionServiceMock.findAll).not.toHaveBeenCalled();
    });

    it('should fetch from services and set cache when no cached value', async () => {
      const resources = [{ id: 'r1', name: 'users' }];
      const actions = [{ id: 'a1', name: 'read' }];
      cacheManagerMock.get.mockResolvedValue(null);
      resourceServiceMock.findAll.mockResolvedValue(resources);
      actionServiceMock.findAll.mockResolvedValue(actions);

      const result = await controller.getMetadata();

      expect(result).toEqual({ resources, actions });
      expect(cacheManagerMock.set).toHaveBeenCalledWith(
        'rbac:metadata',
        { resources, actions },
        60_000
      );
    });

    it('should call both services when cache is empty', async () => {
      resourceServiceMock.findAll.mockResolvedValue([]);
      actionServiceMock.findAll.mockResolvedValue([]);

      await controller.getMetadata();

      expect(resourceServiceMock.findAll).toHaveBeenCalled();
      expect(actionServiceMock.findAll).toHaveBeenCalled();
    });
  });

  // ── findAllResources ──────────────────────────────────────────────

  describe('findAllResources', () => {
    it('should return all resources from resourceService', () => {
      const resources = [{ id: 'r1', name: 'users' }];
      resourceServiceMock.findAll.mockReturnValue(resources);

      const result = controller.findAllResources();

      expect(result).toBe(resources);
      expect(resourceServiceMock.findAll).toHaveBeenCalled();
    });
  });

  // ── updateResource ────────────────────────────────────────────────

  describe('updateResource', () => {
    it('should update resource and return result', async () => {
      const dto = { displayName: 'Users' };
      const updated = { id: 'res-1', displayName: 'Users' };
      resourceServiceMock.update.mockResolvedValue(updated);
      const req = mockJwtRequest() as JwtAuthRequest;

      const result = await controller.updateResource('res-1', dto, req);

      expect(resourceServiceMock.update).toHaveBeenCalledWith('res-1', dto);
      expect(result).toBe(updated);
    });

    it('should invalidate metadata cache after update', async () => {
      const req = mockJwtRequest() as JwtAuthRequest;

      await controller.updateResource('res-1', {}, req);

      expect(cacheManagerMock.del).toHaveBeenCalledWith('rbac:metadata');
    });

    it('should log RESOURCE_UPDATE audit event', async () => {
      const dto = { displayName: 'Users', description: 'desc' };
      const req = mockJwtRequest(
        'user-42',
        'editor@example.com'
      ) as JwtAuthRequest;

      await controller.updateResource('res-1', dto, req);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.RESOURCE_UPDATE,
          actorId: 'user-42',
          actorEmail: 'editor@example.com',
          targetId: 'res-1',
          targetType: 'Resource',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          details: expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            changedFields: expect.arrayContaining([
              'displayName',
              'description'
            ])
          })
        })
      );
    });
  });

  // ── findAllActions ────────────────────────────────────────────────

  describe('findAllActions', () => {
    it('should return all actions from actionService', () => {
      const actions = [{ id: 'a1', name: 'read' }];
      actionServiceMock.findAll.mockReturnValue(actions);

      const result = controller.findAllActions();

      expect(result).toBe(actions);
    });
  });

  // ── createAction ──────────────────────────────────────────────────

  describe('createAction', () => {
    it('should create action and return it', async () => {
      const dto = {
        name: 'export',
        displayName: 'Export',
        description: 'Export data'
      };
      const created = { id: 'act-new', name: 'export' };
      actionServiceMock.create.mockResolvedValue(created);
      const req = mockJwtRequest() as JwtAuthRequest;

      const result = await controller.createAction(dto, req);

      expect(actionServiceMock.create).toHaveBeenCalledWith(dto);
      expect(result).toBe(created);
    });

    it('should invalidate metadata cache after creation', async () => {
      const req = mockJwtRequest() as JwtAuthRequest;

      await controller.createAction(
        { name: 'export', displayName: 'Export', description: '' },
        req
      );

      expect(cacheManagerMock.del).toHaveBeenCalledWith('rbac:metadata');
    });

    it('should log ACTION_CREATE audit event with action name', async () => {
      const dto = { name: 'export', displayName: 'Export', description: '' };
      const created = { id: 'act-new', name: 'export' };
      actionServiceMock.create.mockResolvedValue(created);
      const req = mockJwtRequest(
        'user-1',
        'admin@example.com'
      ) as JwtAuthRequest;

      await controller.createAction(dto, req);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ACTION_CREATE,
          actorId: 'user-1',
          actorEmail: 'admin@example.com',
          targetId: 'act-new',
          targetType: 'Action',
          details: { name: 'export' }
        })
      );
    });
  });

  // ── updateAction ──────────────────────────────────────────────────

  describe('updateAction', () => {
    it('should update action and return result', async () => {
      const dto = { description: 'Updated' };
      const updated = { id: 'act-1', description: 'Updated' };
      actionServiceMock.update.mockResolvedValue(updated);
      const req = mockJwtRequest() as JwtAuthRequest;

      const result = await controller.updateAction('act-1', dto, req);

      expect(actionServiceMock.update).toHaveBeenCalledWith('act-1', dto);
      expect(result).toBe(updated);
    });

    it('should invalidate metadata cache after update', async () => {
      const req = mockJwtRequest() as JwtAuthRequest;

      await controller.updateAction('act-1', {}, req);

      expect(cacheManagerMock.del).toHaveBeenCalledWith('rbac:metadata');
    });

    it('should log ACTION_UPDATE audit event', async () => {
      const dto = { displayName: 'New Name' };
      const req = mockJwtRequest('user-2', 'mod@example.com') as JwtAuthRequest;

      await controller.updateAction('act-1', dto, req);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ACTION_UPDATE,
          actorId: 'user-2',
          actorEmail: 'mod@example.com',
          targetId: 'act-1',
          targetType: 'Action',
          details: { changedFields: ['displayName'] }
        })
      );
    });
  });

  // ── deleteAction ──────────────────────────────────────────────────

  describe('deleteAction', () => {
    it('should delete action', async () => {
      const req = mockJwtRequest() as JwtAuthRequest;

      await controller.deleteAction('act-1', req);

      expect(actionServiceMock.delete).toHaveBeenCalledWith('act-1');
    });

    it('should invalidate metadata cache after deletion', async () => {
      const req = mockJwtRequest() as JwtAuthRequest;

      await controller.deleteAction('act-1', req);

      expect(cacheManagerMock.del).toHaveBeenCalledWith('rbac:metadata');
    });

    it('should log ACTION_DELETE audit event', async () => {
      const req = mockJwtRequest(
        'user-3',
        'deleter@example.com'
      ) as JwtAuthRequest;

      await controller.deleteAction('act-1', req);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ACTION_DELETE,
          actorId: 'user-3',
          actorEmail: 'deleter@example.com',
          targetId: 'act-1',
          targetType: 'Action'
        })
      );
    });

    it('should return undefined (void response)', async () => {
      const req = mockJwtRequest() as JwtAuthRequest;

      const result = await controller.deleteAction('act-1', req);

      expect(result).toBeUndefined();
    });
  });
});
