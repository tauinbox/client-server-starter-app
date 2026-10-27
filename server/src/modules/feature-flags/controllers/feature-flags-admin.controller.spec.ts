import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ErrorKeys } from '@app/shared/constants';
import { createMockResponse } from '../../../common/testing/express.mock';
import { expectApiRejection } from '../../../common/testing/api-error.expect';
import { FeatureFlagsAdminController } from './feature-flags-admin.controller';
import { FeatureFlagService } from '../services/feature-flag.service';
import { FeatureFlagChangedEvent } from '../events/feature-flag-changed.event';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import type { JwtAuthRequest } from '../../auth/types/auth.request';
import { MfaRequiredGuard } from '../../auth/guards/mfa-required.guard';
import {
  AbilityBuilder,
  createMongoAbility
} from '../../auth/casl/app-ability';
import type { AppAbility } from '../../auth/casl/app-ability';

const fullAbility = (() => {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  for (const action of ['create', 'read', 'update', 'delete']) {
    can(action, 'FeatureFlag');
  }
  return build();
})();

describe('FeatureFlagsAdminController', () => {
  let controller: FeatureFlagsAdminController;
  let flagService: {
    findOne: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    preview: jest.Mock;
    getAttributeCustomKeys: jest.Mock;
  };
  let eventEmitter: { emit: jest.Mock };

  const req = {
    user: { userId: 'actor-1', email: 'a@b.com' },
    ip: '127.0.0.1',
    headers: {}
  } as JwtAuthRequest;
  const actor = {
    actorId: 'actor-1',
    actorEmail: 'a@b.com',
    context: { ip: '127.0.0.1', requestId: undefined }
  };
  const sampleFlag = {
    id: 'flag-1',
    key: 'new-dashboard',
    enabled: false,
    version: 1
  };
  const previewResult = {
    result: true,
    reason: 'included-by-rule',
    matchedRule: { index: 0, type: 'role', effect: 'include' }
  };

  beforeEach(async () => {
    flagService = {
      findOne: jest.fn().mockResolvedValue(sampleFlag),
      create: jest.fn().mockResolvedValue(sampleFlag),
      update: jest
        .fn()
        .mockResolvedValue({ ...sampleFlag, enabled: true, version: 2 }),
      delete: jest.fn().mockResolvedValue(undefined),
      preview: jest.fn().mockReturnValue(previewResult),
      getAttributeCustomKeys: jest
        .fn()
        .mockReturnValue({ customKeys: ['billingConfigured'] })
    };
    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeatureFlagsAdminController],
      providers: [
        { provide: FeatureFlagService, useValue: flagService },
        { provide: EventEmitter2, useValue: eventEmitter }
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

  const response = () => createMockResponse({ setHeader: jest.fn() });

  it('findOne passes the ability and the actor and sends the ETag', async () => {
    const res = response();
    await expect(
      controller.findOne('flag-1', req, fullAbility, res)
    ).resolves.toBe(sampleFlag);
    expect(flagService.findOne).toHaveBeenCalledWith(
      'flag-1',
      fullAbility,
      'actor-1'
    );
    expect(res.setHeader).toHaveBeenCalledWith('ETag', '"1"');
  });

  it('create passes the ability and the audit actor, emits a change event and sends the ETag', async () => {
    const res = response();
    await controller.create({ key: 'new-dashboard' }, req, fullAbility, res);
    expect(flagService.create).toHaveBeenCalledWith(
      { key: 'new-dashboard' },
      fullAbility,
      actor
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      FeatureFlagChangedEvent.name,
      expect.any(FeatureFlagChangedEvent)
    );
    expect(res.setHeader).toHaveBeenCalledWith('ETag', '"1"');
  });

  it('update answers 428 without an If-Match header', async () => {
    await expectApiRejection(
      controller.update(
        'flag-1',
        { enabled: true },
        undefined,
        req,
        fullAbility,
        response()
      ),
      ErrorKeys.FEATURE_FLAGS.IF_MATCH_REQUIRED
    );
  });

  it.each(['5', 'abc', '"1', 'W/1'])(
    'update rejects the bad syntax %j with 400 before the lookup',
    async (ifMatch) => {
      await expectApiRejection(
        controller.update(
          'flag-1',
          { enabled: true },
          ifMatch,
          req,
          fullAbility,
          response()
        ),
        ErrorKeys.FEATURE_FLAGS.IF_MATCH_INVALID
      );
      expect(flagService.update).not.toHaveBeenCalled();
    }
  );

  it('update passes the parsed condition, ability and audit actor, and sends the new ETag', async () => {
    const res = response();
    await controller.update(
      'flag-1',
      { enabled: true },
      '"5"',
      req,
      fullAbility,
      res
    );
    expect(flagService.update).toHaveBeenCalledWith(
      'flag-1',
      { enabled: true },
      { any: false, versions: [5] },
      fullAbility,
      actor
    );
    expect(res.setHeader).toHaveBeenCalledWith('ETag', '"2"');
  });

  it('preview evaluates the flag that the checked read returns', async () => {
    await expect(
      controller.preview('flag-1', { roles: ['beta'] }, req, fullAbility)
    ).resolves.toBe(previewResult);
    expect(flagService.findOne).toHaveBeenCalledWith(
      'flag-1',
      fullAbility,
      'actor-1'
    );
    expect(flagService.preview).toHaveBeenCalledWith(sampleFlag, {
      roles: ['beta']
    });
  });

  it('delete passes the ability and emits a change event', async () => {
    await controller.remove('flag-1', req, fullAbility);
    expect(flagService.delete).toHaveBeenCalledWith(
      'flag-1',
      fullAbility,
      actor
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      FeatureFlagChangedEvent.name,
      expect.any(FeatureFlagChangedEvent)
    );
  });
});
