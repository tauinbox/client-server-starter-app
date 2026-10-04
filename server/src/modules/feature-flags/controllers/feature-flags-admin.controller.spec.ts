import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ForbiddenException, HttpException } from '@nestjs/common';
import { FeatureFlagsAdminController } from './feature-flags-admin.controller';
import { FeatureFlagService } from '../services/feature-flag.service';
import { FeatureFlagChangedEvent } from '../events/feature-flag-changed.event';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import type { JwtAuthRequest } from '../../auth/types/auth.request';
import { MfaRequiredGuard } from '../../auth/guards/mfa-required.guard';
import { MetricsService } from '../../core/metrics/metrics.service';
import {
  AbilityBuilder,
  createMongoAbility
} from '../../auth/casl/app-ability';
import type { AppAbility } from '../../auth/casl/app-ability';

function abilityFor(
  actions: string[],
  conditions?: Record<string, unknown>
): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  for (const action of actions) can(action, 'FeatureFlag', conditions);
  return build();
}

const fullAbility = abilityFor(['create', 'read', 'update', 'delete']);

describe('FeatureFlagsAdminController', () => {
  let controller: FeatureFlagsAdminController;
  let flagService: {
    findOne: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    getAttributeCustomKeys: jest.Mock;
    newFlagFields: FeatureFlagService['newFlagFields'];
  };
  let eventEmitter: { emit: jest.Mock };
  let auditService: { log: jest.Mock; logFireAndForget: jest.Mock };

  const req = {
    user: { userId: 'actor-1', email: 'a@b.com' },
    ip: '127.0.0.1',
    headers: {}
  } as JwtAuthRequest;
  const sampleFlag = {
    id: 'flag-1',
    key: 'new-dashboard',
    enabled: false,
    version: 1
  };

  beforeEach(async () => {
    flagService = {
      findOne: jest.fn().mockResolvedValue(sampleFlag),
      newFlagFields: FeatureFlagService.prototype.newFlagFields,
      create: jest.fn().mockResolvedValue(sampleFlag),
      update: jest
        .fn()
        .mockResolvedValue({ ...sampleFlag, enabled: true, version: 2 }),
      delete: jest.fn().mockResolvedValue(undefined),
      getAttributeCustomKeys: jest
        .fn()
        .mockReturnValue({ customKeys: ['billingConfigured'] })
    };
    eventEmitter = { emit: jest.fn() };
    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
      logFireAndForget: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeatureFlagsAdminController],
      providers: [
        { provide: FeatureFlagService, useValue: flagService },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: AuditService, useValue: auditService },
        {
          provide: MetricsService,
          useValue: { recordPermissionDenied: jest.fn() }
        }
      ]
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(MfaRequiredGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(FeatureFlagsAdminController);
  });

  it('getAttributeKeys returns the registered custom keys', () => {
    expect(controller.getAttributeKeys()).toEqual({
      customKeys: ['billingConfigured']
    });
    expect(flagService.getAttributeCustomKeys).toHaveBeenCalled();
  });

  it('create emits a change event', async () => {
    await controller.create({ key: 'new-dashboard' }, req, fullAbility);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      FeatureFlagChangedEvent.name,
      expect.any(FeatureFlagChangedEvent)
    );
  });

  it('update requires If-Match header', async () => {
    await expect(
      controller.update(
        'flag-1',
        { enabled: true },
        undefined,
        req,
        fullAbility
      )
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('update rejects non-integer If-Match', async () => {
    await expect(
      controller.update('flag-1', { enabled: true }, 'abc', req, fullAbility)
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('update strips quoted ETag and passes parsed version', async () => {
    await controller.update(
      'flag-1',
      { enabled: true },
      '"5"',
      req,
      fullAbility
    );
    expect(flagService.update).toHaveBeenCalledWith(
      'flag-1',
      { enabled: true },
      5,
      'actor-1'
    );
  });

  it('update audits a rule set as a count, not as a changed field', async () => {
    const rules = [
      {
        type: 'role' as const,
        effect: 'include' as const,
        payload: { type: 'role' as const, roleNames: ['beta'] }
      }
    ];
    await controller.update(
      'flag-1',
      { enabled: true, rules },
      '1',
      req,
      fullAbility
    );
    expect(flagService.update).toHaveBeenCalledWith(
      'flag-1',
      { enabled: true, rules },
      1,
      'actor-1'
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.FEATURE_FLAG_UPDATE,
        details: { changedFields: ['enabled'], ruleCount: 1 }
      })
    );
  });

  it('update without rules leaves the rule count out of the audit', async () => {
    await controller.update('flag-1', { enabled: true }, '1', req, fullAbility);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { changedFields: ['enabled'] }
      })
    );
  });

  it('delete removes the loaded flag and emits a change event', async () => {
    await controller.remove('flag-1', req, fullAbility);
    expect(flagService.findOne).toHaveBeenCalledTimes(1);
    expect(flagService.delete).toHaveBeenCalledWith(sampleFlag);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      FeatureFlagChangedEvent.name,
      expect.any(FeatureFlagChangedEvent)
    );
  });

  it('delete records the flag key in the audit details', async () => {
    await controller.remove('flag-1', req, fullAbility);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.FEATURE_FLAG_DELETE,
        actorId: 'actor-1',
        actorEmail: 'a@b.com',
        targetId: 'flag-1',
        targetType: 'FeatureFlag',
        details: { key: 'new-dashboard' }
      })
    );
  });

  describe('a grant with a condition', () => {
    const scoped = abilityFor(['read', 'update', 'delete', 'create'], {
      key: 'other-flag'
    });

    it.each([
      ['findOne', () => controller.findOne('flag-1', req, scoped)],
      ['preview', () => controller.preview('flag-1', {}, req, scoped)],
      ['remove', () => controller.remove('flag-1', req, scoped)],
      [
        'update',
        () => controller.update('flag-1', { enabled: true }, '1', req, scoped)
      ],
      ['create', () => controller.create({ key: 'new-dashboard' }, req, scoped)]
    ])('%s refuses a flag outside the condition', async (_name, call) => {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
      expect(flagService.create).not.toHaveBeenCalled();
      expect(flagService.update).not.toHaveBeenCalled();
      expect(flagService.delete).not.toHaveBeenCalled();
    });

    it('allows a flag inside the condition', async () => {
      const own = abilityFor(['read'], { key: 'new-dashboard' });
      await expect(controller.findOne('flag-1', req, own)).resolves.toBe(
        sampleFlag
      );
    });

    it('create checks the record with the defaults the service writes', async () => {
      const disabledOnly = abilityFor(['create'], { enabled: false });
      await controller.create({ key: 'new-dashboard' }, req, disabledOnly);
      await expect(
        controller.create(
          { key: 'new-dashboard', enabled: true },
          req,
          disabledOnly
        )
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('update refuses a write that moves the flag out of the condition', async () => {
      const disabledOnly = abilityFor(['update'], { enabled: false });
      await expect(
        controller.update('flag-1', { enabled: true }, '1', req, disabledOnly)
      ).rejects.toBeInstanceOf(ForbiddenException);
      await controller.update(
        'flag-1',
        { description: 'x' },
        '1',
        req,
        disabledOnly
      );
      expect(flagService.update).toHaveBeenCalledTimes(1);
    });
  });
});
