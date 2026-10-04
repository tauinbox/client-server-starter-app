import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import type { EntityManager } from 'typeorm';
import { RoleRulesListener } from './role-rules.listener';
import { FeatureFlagService } from '../services/feature-flag.service';
import { FeatureFlagChangedEvent } from '../events/feature-flag-changed.event';
import { RoleRenamedEvent } from '../../auth/events/role-renamed.event';
import { RoleDeletedEvent } from '../../auth/events/role-deleted.event';

describe('RoleRulesListener', () => {
  // The listener only passes the manager through to the service mock.
  const em = {} as EntityManager;

  let module: TestingModule;
  let eventEmitter: EventEmitter2;
  let flagService: { rewriteRoleName: jest.Mock };
  let flagChanged: jest.Mock;
  let commit: () => void;
  let committed: Promise<void>;

  beforeEach(async () => {
    flagService = { rewriteRoleName: jest.fn().mockResolvedValue([]) };
    committed = new Promise<void>((resolve) => {
      commit = resolve;
    });

    module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        RoleRulesListener,
        { provide: FeatureFlagService, useValue: flagService }
      ]
    }).compile();

    await module.init();
    eventEmitter = module.get(EventEmitter2);
    flagChanged = jest.fn();
    eventEmitter.on(FeatureFlagChangedEvent.name, flagChanged);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should rewrite the old name to the new name in the role transaction', async () => {
    await eventEmitter.emitAsync(
      RoleRenamedEvent.name,
      new RoleRenamedEvent('beta', 'beta-2', em, committed)
    );

    expect(flagService.rewriteRoleName).toHaveBeenCalledWith(
      em,
      'beta',
      'beta-2'
    );
  });

  it('should remove the name on delete', async () => {
    await eventEmitter.emitAsync(
      RoleDeletedEvent.name,
      new RoleDeletedEvent('beta', em, committed)
    );

    expect(flagService.rewriteRoleName).toHaveBeenCalledWith(em, 'beta', null);
  });

  it('should announce the changed flags once, only after the commit', async () => {
    flagService.rewriteRoleName.mockResolvedValue(['flag-a', 'flag-b']);

    await eventEmitter.emitAsync(
      RoleDeletedEvent.name,
      new RoleDeletedEvent('beta', em, committed)
    );
    expect(flagChanged).not.toHaveBeenCalled();

    commit();
    await committed;

    expect(flagChanged).toHaveBeenCalledTimes(1);
    expect(flagChanged).toHaveBeenCalledWith(new FeatureFlagChangedEvent());
  });

  it('should announce nothing when no rule names the role', async () => {
    await eventEmitter.emitAsync(
      RoleRenamedEvent.name,
      new RoleRenamedEvent('beta', 'beta-2', em, committed)
    );
    commit();
    await committed;

    expect(flagChanged).not.toHaveBeenCalled();
  });

  it.each([
    ['rename', () => new RoleRenamedEvent('beta', 'beta-2', em, committed)],
    ['delete', () => new RoleDeletedEvent('beta', em, committed)]
  ])(
    'should propagate a failed rewrite on %s to the emitter',
    async (_name, makeEvent) => {
      flagService.rewriteRoleName.mockRejectedValue(new Error('db down'));
      const event = makeEvent();

      await expect(
        eventEmitter.emitAsync(event.constructor.name, event)
      ).rejects.toThrow('db down');
    }
  );
});
