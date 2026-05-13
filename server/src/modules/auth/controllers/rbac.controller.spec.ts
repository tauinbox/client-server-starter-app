import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ForbiddenException, HttpException, Logger } from '@nestjs/common';
import { RbacController } from './rbac.controller';
import { ResourceService } from '../services/resource.service';
import { ActionService } from '../services/action.service';
import { AuditService } from '../../audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { JwtAuthRequest } from '../types/auth.request';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import type { AppAbility } from '../casl/app-ability';

const allowAllGuard = { canActivate: () => true };

// @ts-expect-error partial mock — only `can` is needed for controller delegation tests
const mockAbility: AppAbility = { can: jest.fn().mockReturnValue(true) };

// @ts-expect-error partial mock — drives the deny path of assertCan
const denyAbility: AppAbility = { can: jest.fn().mockReturnValue(false) };

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
    findOne: jest.Mock;
    update: jest.Mock;
    restore: jest.Mock;
  };
  let actionServiceMock: {
    findAll: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let auditServiceMock: {
    log: jest.Mock;
    logFireAndForget: jest.Mock;
  };
  let metricsServiceMock: { recordPermissionDenied: jest.Mock };
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
      findOne: jest.fn().mockResolvedValue({ id: 'res-1', name: 'users' }),
      update: jest.fn().mockResolvedValue({ id: 'res-1' }),
      restore: jest.fn().mockResolvedValue({ id: 'res-1', isOrphaned: false })
    };

    actionServiceMock = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'act-1', name: 'export' }),
      create: jest.fn().mockResolvedValue({ id: 'act-1', name: 'export' }),
      update: jest.fn().mockResolvedValue({ id: 'act-1' }),
      delete: jest.fn().mockResolvedValue(undefined)
    };

    auditServiceMock = {
      log: jest.fn().mockResolvedValue(undefined),
      logFireAndForget: jest.fn()
    };

    metricsServiceMock = { recordPermissionDenied: jest.fn() };

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
        { provide: MetricsService, useValue: metricsServiceMock },
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
    it('should load the resource, assert update access, update, and return result', async () => {
      const dto = { displayName: 'Users' };
      const updated = { id: 'res-1', displayName: 'Users' };
      resourceServiceMock.findOne.mockResolvedValue({ id: 'res-1' });
      resourceServiceMock.update.mockResolvedValue(updated);
      const req = mockJwtRequest() as JwtAuthRequest;

      const result = await controller.updateResource(
        'res-1',
        dto,
        req,
        mockAbility
      );

      expect(resourceServiceMock.findOne).toHaveBeenCalledWith('res-1');
      expect(resourceServiceMock.update).toHaveBeenCalledWith('res-1', dto);
      expect(result).toBe(updated);
    });

    it('should throw 404 when resource does not exist', async () => {
      resourceServiceMock.findOne.mockResolvedValue(null);
      const req = mockJwtRequest() as JwtAuthRequest;

      await expect(
        controller.updateResource('missing', {}, req, mockAbility)
      ).rejects.toBeInstanceOf(HttpException);
      expect(resourceServiceMock.update).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException and skip update when ability denies', async () => {
      resourceServiceMock.findOne.mockResolvedValue({ id: 'res-1' });
      const req = mockJwtRequest('actor-deny') as JwtAuthRequest;

      await expect(
        controller.updateResource('res-1', {}, req, denyAbility)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(resourceServiceMock.update).not.toHaveBeenCalled();
      expect(auditServiceMock.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PERMISSION_CHECK_FAILURE,
          actorId: 'actor-deny',
          targetId: 'res-1',
          targetType: 'Resource'
        })
      );
    });

    it('should invalidate metadata cache after update', async () => {
      const req = mockJwtRequest() as JwtAuthRequest;
      resourceServiceMock.findOne.mockResolvedValue({ id: 'res-1' });

      await controller.updateResource('res-1', {}, req, mockAbility);

      expect(cacheManagerMock.del).toHaveBeenCalledWith('rbac:metadata');
    });

    it('should log RESOURCE_UPDATE audit event', async () => {
      const dto = { displayName: 'Users', description: 'desc' };
      const req = mockJwtRequest(
        'user-42',
        'editor@example.com'
      ) as JwtAuthRequest;
      resourceServiceMock.findOne.mockResolvedValue({ id: 'res-1' });

      await controller.updateResource('res-1', dto, req, mockAbility);

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

  describe('restoreResource', () => {
    it('should throw 404 when resource does not exist', async () => {
      resourceServiceMock.findOne.mockResolvedValue(null);
      const req = mockJwtRequest() as JwtAuthRequest;

      await expect(
        controller.restoreResource('missing', req, mockAbility)
      ).rejects.toBeInstanceOf(HttpException);
      expect(resourceServiceMock.restore).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException and skip restore when ability denies', async () => {
      resourceServiceMock.findOne.mockResolvedValue({ id: 'res-1' });
      const req = mockJwtRequest('actor-deny') as JwtAuthRequest;

      await expect(
        controller.restoreResource('res-1', req, denyAbility)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(resourceServiceMock.restore).not.toHaveBeenCalled();
    });

    it('should restore resource when ability allows and log RESOURCE_RESTORE', async () => {
      resourceServiceMock.findOne.mockResolvedValue({ id: 'res-1' });
      resourceServiceMock.restore.mockResolvedValue({
        id: 'res-1',
        isOrphaned: false
      });
      const req = mockJwtRequest('user-99', 'a@example.com') as JwtAuthRequest;

      await controller.restoreResource('res-1', req, mockAbility);

      expect(resourceServiceMock.restore).toHaveBeenCalledWith('res-1');
      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.RESOURCE_RESTORE,
          actorId: 'user-99',
          targetId: 'res-1',
          targetType: 'Resource'
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
    it('should load the action, assert update access, update, and return result', async () => {
      const dto = { description: 'Updated' };
      const updated = { id: 'act-1', description: 'Updated' };
      actionServiceMock.findOne.mockResolvedValue({ id: 'act-1' });
      actionServiceMock.update.mockResolvedValue(updated);
      const req = mockJwtRequest() as JwtAuthRequest;

      const result = await controller.updateAction(
        'act-1',
        dto,
        req,
        mockAbility
      );

      expect(actionServiceMock.findOne).toHaveBeenCalledWith('act-1');
      expect(actionServiceMock.update).toHaveBeenCalledWith('act-1', dto);
      expect(result).toBe(updated);
    });

    it('should throw ForbiddenException and skip update when ability denies', async () => {
      actionServiceMock.findOne.mockResolvedValue({ id: 'act-1' });
      const req = mockJwtRequest('actor-deny') as JwtAuthRequest;

      await expect(
        controller.updateAction('act-1', {}, req, denyAbility)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(actionServiceMock.update).not.toHaveBeenCalled();
    });

    it('should invalidate metadata cache after update', async () => {
      const req = mockJwtRequest() as JwtAuthRequest;
      actionServiceMock.findOne.mockResolvedValue({ id: 'act-1' });

      await controller.updateAction('act-1', {}, req, mockAbility);

      expect(cacheManagerMock.del).toHaveBeenCalledWith('rbac:metadata');
    });

    it('should log ACTION_UPDATE audit event', async () => {
      const dto = { displayName: 'New Name' };
      const req = mockJwtRequest('user-2', 'mod@example.com') as JwtAuthRequest;
      actionServiceMock.findOne.mockResolvedValue({ id: 'act-1' });

      await controller.updateAction('act-1', dto, req, mockAbility);

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
    it('should load the action, assert delete access, then delete', async () => {
      const req = mockJwtRequest() as JwtAuthRequest;
      actionServiceMock.findOne.mockResolvedValue({ id: 'act-1' });

      await controller.deleteAction('act-1', req, mockAbility);

      expect(actionServiceMock.findOne).toHaveBeenCalledWith('act-1');
      expect(actionServiceMock.delete).toHaveBeenCalledWith('act-1');
    });

    it('should throw ForbiddenException and skip delete when ability denies', async () => {
      actionServiceMock.findOne.mockResolvedValue({ id: 'act-1' });
      const req = mockJwtRequest('actor-deny') as JwtAuthRequest;

      await expect(
        controller.deleteAction('act-1', req, denyAbility)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(actionServiceMock.delete).not.toHaveBeenCalled();
    });

    it('should invalidate metadata cache after deletion', async () => {
      const req = mockJwtRequest() as JwtAuthRequest;
      actionServiceMock.findOne.mockResolvedValue({ id: 'act-1' });

      await controller.deleteAction('act-1', req, mockAbility);

      expect(cacheManagerMock.del).toHaveBeenCalledWith('rbac:metadata');
    });

    it('should log ACTION_DELETE audit event', async () => {
      const req = mockJwtRequest(
        'user-3',
        'deleter@example.com'
      ) as JwtAuthRequest;
      actionServiceMock.findOne.mockResolvedValue({ id: 'act-1' });

      await controller.deleteAction('act-1', req, mockAbility);

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
      actionServiceMock.findOne.mockResolvedValue({ id: 'act-1' });

      const result = await controller.deleteAction('act-1', req, mockAbility);

      expect(result).toBeUndefined();
    });
  });
});
