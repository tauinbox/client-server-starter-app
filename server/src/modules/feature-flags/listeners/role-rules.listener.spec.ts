import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import type { EntityManager } from 'typeorm';
import { RoleRulesListener } from './role-rules.listener';
import { FeatureFlagService } from '../services/feature-flag.service';
import { RoleRenamedEvent } from '../../auth/events/role-renamed.event';
import { RoleDeletedEvent } from '../../auth/events/role-deleted.event';

describe('RoleRulesListener', () => {
  // The listener only passes the manager through to the service mock.
  const em = {} as EntityManager;

  let module: TestingModule;
  let eventEmitter: EventEmitter2;
  let flagService: { rewriteRoleName: jest.Mock };

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
  });

  afterEach(async () => {
    await module.close();
  });

  it('should rewrite the old name to the new name in the role transaction', async () => {
    await eventEmitter.emitAsync(
      RoleRenamedEvent.name,
      new RoleRenamedEvent('beta', 'beta-2', em)
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
      new RoleDeletedEvent('beta', em)
    );

    expect(flagService.rewriteRoleName).toHaveBeenCalledWith(em, 'beta', null);
  });

  it.each([
    [
      'rename',
      RoleRenamedEvent.name,
      () => new RoleRenamedEvent('beta', 'beta-2', em)
    ],
    ['delete', RoleDeletedEvent.name, () => new RoleDeletedEvent('beta', em)]
  ])(
    'should propagate a failed rewrite on %s to the emitter',
    async (_case, name, makeEvent) => {
      flagService.rewriteRoleName.mockRejectedValue(new Error('db down'));

      await expect(eventEmitter.emitAsync(name, makeEvent())).rejects.toThrow(
        'db down'
      );
    }
  );
});
