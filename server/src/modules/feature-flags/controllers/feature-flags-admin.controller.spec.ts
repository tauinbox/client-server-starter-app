import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HttpException } from '@nestjs/common';
import { FeatureFlagsAdminController } from './feature-flags-admin.controller';
import { FeatureFlagService } from '../services/feature-flag.service';
import { FeatureFlagChangedEvent } from '../events/feature-flag-changed.event';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import type { JwtAuthRequest } from '../../auth/types/auth.request';
import { MfaRequiredGuard } from '../../auth/guards/mfa-required.guard';

describe('FeatureFlagsAdminController', () => {
  let controller: FeatureFlagsAdminController;
  let flagService: {
    findAll: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    toggle: jest.Mock;
    delete: jest.Mock;
    replaceRules: jest.Mock;
    getAttributeCustomKeys: jest.Mock;
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
      findAll: jest.fn().mockResolvedValue([sampleFlag]),
      findOne: jest.fn().mockResolvedValue(sampleFlag),
      create: jest.fn().mockResolvedValue(sampleFlag),
      update: jest
        .fn()
        .mockResolvedValue({ ...sampleFlag, enabled: true, version: 2 }),
      toggle: jest
        .fn()
        .mockResolvedValue({ ...sampleFlag, enabled: true, version: 2 }),
      delete: jest.fn().mockResolvedValue(undefined),
      replaceRules: jest.fn().mockResolvedValue(sampleFlag),
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
        { provide: AuditService, useValue: auditService }
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

  it('create emits a "created" change event', async () => {
    await controller.create({ key: 'new-dashboard' }, req);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      FeatureFlagChangedEvent.name,
      expect.objectContaining({
        flagKey: 'new-dashboard',
        changeType: 'created'
      })
    );
  });

  it('update requires If-Match header', async () => {
    await expect(
      controller.update('flag-1', { enabled: true }, undefined, req)
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('update rejects non-integer If-Match', async () => {
    await expect(
      controller.update('flag-1', { enabled: true }, 'abc', req)
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('update strips quoted ETag and passes parsed version', async () => {
    await controller.update('flag-1', { enabled: true }, '"5"', req);
    expect(flagService.update).toHaveBeenCalledWith(
      'flag-1',
      { enabled: true },
      5,
      'actor-1'
    );
  });

  it('toggle emits a "toggled" change event', async () => {
    await controller.toggle('flag-1', req);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      FeatureFlagChangedEvent.name,
      expect.objectContaining({ changeType: 'toggled' })
    );
  });

  it('replaceRules emits a "rules-replaced" change event', async () => {
    await controller.replaceRules('flag-1', { rules: [] }, req);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      FeatureFlagChangedEvent.name,
      expect.objectContaining({ changeType: 'rules-replaced' })
    );
  });

  it('delete emits a "deleted" change event with the flag key', async () => {
    await controller.remove('flag-1', req);
    expect(flagService.delete).toHaveBeenCalledWith('flag-1');
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      FeatureFlagChangedEvent.name,
      expect.objectContaining({
        flagKey: 'new-dashboard',
        changeType: 'deleted'
      })
    );
  });

  it('delete records the flag key in the audit details', async () => {
    await controller.remove('flag-1', req);
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
});
