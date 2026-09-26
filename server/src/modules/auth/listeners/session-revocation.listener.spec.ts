import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { SessionRevocationListener } from './session-revocation.listener';
import { AuthService } from '../services/auth.service';
import { UserSessionRevocationRequiredEvent } from '../../users/events/user-session-revocation-required.event';

describe('SessionRevocationListener', () => {
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
        SessionRevocationListener,
        { provide: AuthService, useValue: authService }
      ]
    }).compile();

    await module.init();
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should revoke every session of the user', async () => {
    await eventEmitter.emitAsync(
      UserSessionRevocationRequiredEvent.name,
      new UserSessionRevocationRequiredEvent('user-123')
    );

    expect(authService.revokeAllUserSessions).toHaveBeenCalledWith('user-123');
  });

  it('should propagate a failure to the emitter so the caller can fail the request', async () => {
    authService.revokeAllUserSessions.mockRejectedValue(new Error('db down'));

    await expect(
      eventEmitter.emitAsync(
        UserSessionRevocationRequiredEvent.name,
        new UserSessionRevocationRequiredEvent('user-123')
      )
    ).rejects.toThrow('db down');
  });
});
