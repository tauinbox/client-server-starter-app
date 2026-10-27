import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { UserRoleChangedListener } from './user-role-changed.listener';
import { AuthService } from '../services/auth.service';
import { UserRoleChangedEvent } from '../events/user-role-changed.event';

describe('UserRoleChangedListener', () => {
  let module: TestingModule;
  let eventEmitter: EventEmitter2;
  let authService: { revokeAllUserSessions: jest.Mock };

  beforeEach(async () => {
    authService = {
      revokeAllUserSessions: jest.fn().mockResolvedValue(undefined)
    };

    module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        UserRoleChangedListener,
        { provide: AuthService, useValue: authService }
      ]
    }).compile();

    await module.init();
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should revoke every session on role change', async () => {
    const userId = 'user-789';

    await eventEmitter.emitAsync(
      UserRoleChangedEvent.name,
      new UserRoleChangedEvent(userId)
    );

    expect(authService.revokeAllUserSessions).toHaveBeenCalledWith(userId);
  });

  it('should propagate a failure of session revocation to the emitter so the caller can fail the request', async () => {
    authService.revokeAllUserSessions.mockRejectedValue(new Error('db down'));

    await expect(
      eventEmitter.emitAsync(
        UserRoleChangedEvent.name,
        new UserRoleChangedEvent('user-789')
      )
    ).rejects.toThrow('db down');
  });
});
