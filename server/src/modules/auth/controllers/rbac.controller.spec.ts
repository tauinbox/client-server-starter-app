import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { RbacController } from './rbac.controller';
import { ResourceService } from '../services/resource.service';
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

function mockJwtRequest(
  userId = 'user-1',
  email = 'admin@example.com'
): {
  user: JwtAuthRequest['user'];
  ip: string;
  headers: Record<string, string>;
} {
  return {
    user: { userId, email, sessionId: 'session-1' },
    ip: '127.0.0.1',
    headers: {}
  };
}

describe('RbacController', () => {
  let controller: RbacController;
  let resourceServiceMock: {
    findAll: jest.Mock;
    update: jest.Mock;
    restore: jest.Mock;
  };
  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    resourceServiceMock = {
      findAll: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'res-1' }),
      restore: jest.fn().mockResolvedValue({ id: 'res-1', isOrphaned: false })
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RbacController],
      providers: [{ provide: ResourceService, useValue: resourceServiceMock }]
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

  // ── findAllResources ──────────────────────────────────────────────

  describe('findAllResources', () => {
    it('is gated by @Authorize([read, Permission]) like the sibling read endpoints', () => {
      // Descriptor lookup instead of a direct method reference: the handler is
      // only a Reflect metadata target here, never invoked.
      const handler = Object.getOwnPropertyDescriptor(
        RbacController.prototype,
        'findAllResources'
      )!.value as object;

      const checks = Reflect.getMetadata(PERMISSIONS_KEY, handler) as unknown;
      expect(checks).toEqual([['read', 'Permission']]);

      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
      expect(guards).toContain(PermissionsGuard);
    });

    it('should return all resources from resourceService', () => {
      const resources = [{ id: 'r1', name: 'users' }];
      resourceServiceMock.findAll.mockReturnValue(resources);

      const result = controller.findAllResources();

      expect(result).toBe(resources);
      expect(resourceServiceMock.findAll).toHaveBeenCalled();
    });
  });

  // ── updateResource ────────────────────────────────────────────────

  // The 404 and the instance check run in ResourceService
  // (resource.service.spec.ts, "instance check of update:Permission").
  describe('updateResource', () => {
    it('passes the dto, the ability and the actor to the update and returns its result', async () => {
      const dto = { displayName: 'Users' };
      const updated = { id: 'res-1', displayName: 'Users' };
      resourceServiceMock.update.mockResolvedValue(updated);
      const req = mockJwtRequest() as JwtAuthRequest;

      const result = await controller.updateResource(
        'res-1',
        dto,
        req,
        mockAbility
      );

      expect(resourceServiceMock.update).toHaveBeenCalledWith(
        'res-1',
        dto,
        mockAbility,
        'user-1',
        expect.any(Function)
      );
      expect(result).toBe(updated);
    });

    it('builds the RESOURCE_UPDATE audit row from the resource before the write', async () => {
      const dto = { displayName: 'Users', description: 'desc' };
      const req = mockJwtRequest(
        'user-42',
        'editor@example.com'
      ) as JwtAuthRequest;

      await controller.updateResource('res-1', dto, req, mockAbility);

      const [, , , , row] = resourceServiceMock.update.mock.calls[0] as [
        unknown,
        unknown,
        unknown,
        unknown,
        (before: { displayName: string; description: string }) => unknown
      ];
      expect(row({ displayName: 'Old', description: 'old' })).toMatchObject({
        action: AuditAction.RESOURCE_UPDATE,
        actorId: 'user-42',
        actorEmail: 'editor@example.com',
        targetId: 'res-1',
        targetType: 'Resource',
        details: { changedFields: ['displayName', 'description'] }
      });
    });
  });

  describe('restoreResource', () => {
    it('should restore resource with the ability, the actor and the RESOURCE_RESTORE audit row', async () => {
      resourceServiceMock.restore.mockResolvedValue({
        id: 'res-1',
        isOrphaned: false
      });
      const req = mockJwtRequest('user-99', 'a@example.com') as JwtAuthRequest;

      await controller.restoreResource('res-1', req, mockAbility);

      expect(resourceServiceMock.restore).toHaveBeenCalledWith(
        'res-1',
        mockAbility,
        'user-99',
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
