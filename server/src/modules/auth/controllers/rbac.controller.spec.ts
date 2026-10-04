import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ForbiddenException, HttpException, Logger } from '@nestjs/common';
import { RbacController } from './rbac.controller';
import { ResourceService } from '../services/resource.service';
import { AuditService } from '../../audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { JwtAuthRequest } from '../types/auth.request';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { AppAbility } from '../casl/app-ability';
import { MfaRequiredGuard } from '../guards/mfa-required.guard';

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
    user: { userId, email, roles: [], sessionId: 'session-1' },
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
        { provide: AuditService, useValue: auditServiceMock },
        { provide: MetricsService, useValue: metricsServiceMock },
        { provide: CACHE_MANAGER, useValue: cacheManagerMock }
      ]
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowAllGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(allowAllGuard)
      .overrideGuard(MfaRequiredGuard)
      .useValue({ canActivate: () => true })
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
    it('is gated by @Authorize([read, Permission]) like the sibling read endpoints', () => {
      // Descriptor lookup instead of a direct method reference: the handler is
      // only a Reflect metadata target here, never invoked.
      const handler = Object.getOwnPropertyDescriptor(
        RbacController.prototype,
        'getMetadata'
      )!.value as object;

      const checks = Reflect.getMetadata(PERMISSIONS_KEY, handler) as unknown;
      expect(checks).toEqual([['read', 'Permission']]);

      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
      expect(guards).toContain(PermissionsGuard);
    });

    it('should return cached value without fetching services', async () => {
      const cached = { resources: [] };
      cacheManagerMock.get.mockResolvedValue(cached);

      const result = await controller.getMetadata();

      expect(result).toBe(cached);
      expect(resourceServiceMock.findAll).not.toHaveBeenCalled();
    });

    it('should fetch resources and set cache when no cached value', async () => {
      const resources = [{ id: 'r1', name: 'users' }];
      cacheManagerMock.get.mockResolvedValue(null);
      resourceServiceMock.findAll.mockResolvedValue(resources);

      const result = await controller.getMetadata();

      expect(result).toEqual({ resources });
      expect(cacheManagerMock.set).toHaveBeenCalledWith(
        'rbac:metadata',
        { resources },
        60_000
      );
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
});
