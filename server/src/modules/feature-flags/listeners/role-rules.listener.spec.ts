import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { RoleRulesListener } from './role-rules.listener';
import { FeatureFlagService } from '../services/feature-flag.service';
import { FeatureFlagChangedEvent } from '../events/feature-flag-changed.event';
import { RoleRenamedEvent } from '../../auth/events/role-renamed.event';
import { RoleDeletedEvent } from '../../auth/events/role-deleted.event';

describe('RoleRulesListener', () => {
  let module: TestingModule;
  let eventEmitter: EventEmitter2;
  let flagService: { rewriteRoleName: jest.Mock };
  let flagChanged: jest.Mock;

  beforeEach(async () => {
    flagService = { rewriteRoleName: jest.fn().mockResolvedValue([]) };

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

  it('should rewrite the old name to the new name on rename', async () => {
    await eventEmitter.emitAsync(
      RoleRenamedEvent.name,
      new RoleRenamedEvent('beta', 'beta-2')
    );

    expect(flagService.rewriteRoleName).toHaveBeenCalledWith('beta', 'beta-2');
  });

  it('should remove the name on delete', async () => {
    await eventEmitter.emitAsync(
      RoleDeletedEvent.name,
      new RoleDeletedEvent('beta')
    );

    expect(flagService.rewriteRoleName).toHaveBeenCalledWith('beta', null);
  });

  it('should announce each changed flag so the flag caches reset', async () => {
    flagService.rewriteRoleName.mockResolvedValue(['flag-a', 'flag-b']);

    await eventEmitter.emitAsync(
      RoleDeletedEvent.name,
      new RoleDeletedEvent('beta')
    );

    expect(flagChanged).toHaveBeenCalledTimes(2);
    expect(flagChanged).toHaveBeenCalledWith(
      new FeatureFlagChangedEvent('flag-a', 'rules-replaced')
    );
    expect(flagChanged).toHaveBeenCalledWith(
      new FeatureFlagChangedEvent('flag-b', 'rules-replaced')
    );
  });

  it('should announce nothing when no rule names the role', async () => {
    await eventEmitter.emitAsync(
      RoleRenamedEvent.name,
      new RoleRenamedEvent('beta', 'beta-2')
    );

    expect(flagChanged).not.toHaveBeenCalled();
  });

  it.each([
    ['rename', () => new RoleRenamedEvent('beta', 'beta-2')],
    ['delete', () => new RoleDeletedEvent('beta')]
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
