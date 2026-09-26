import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { UserRoleChangedListener } from './user-role-changed.listener';
import { AuthService } from '../services/auth.service';
import { PermissionService } from '../services/permission.service';
import { UserRoleChangedEvent } from '../events/user-role-changed.event';

describe('UserRoleChangedListener', () => {
  let module: TestingModule;
  let eventEmitter: EventEmitter2;
  let authService: { revokeAllUserSessions: jest.Mock };
  let permissionService: { invalidateUserCache: jest.Mock };

  beforeEach(async () => {
    authService = {
      revokeAllUserSessions: jest.fn().mockResolvedValue(undefined)
    };
    permissionService = {
      invalidateUserCache: jest.fn().mockResolvedValue(undefined)
    };

    module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        UserRoleChangedListener,
        { provide: AuthService, useValue: authService },
        { provide: PermissionService, useValue: permissionService }
      ]
    }).compile();

    await module.init();
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should revoke every session and invalidate the permission cache on role change', async () => {
    const userId = 'user-789';

    await eventEmitter.emitAsync(
      UserRoleChangedEvent.name,
      new UserRoleChangedEvent(userId)
    );

    expect(authService.revokeAllUserSessions).toHaveBeenCalledWith(userId);
    expect(permissionService.invalidateUserCache).toHaveBeenCalledWith(userId);
  });

  it.each([
    [
      'session revocation',
      () =>
        authService.revokeAllUserSessions.mockRejectedValue(
          new Error('db down')
        )
    ],
    [
      'permission cache invalidation',
      () =>
        permissionService.invalidateUserCache.mockRejectedValue(
          new Error('db down')
        )
    ]
  ])(
    'should propagate a failure of %s to the emitter so the caller can fail the request',
    async (_name, arrange) => {
      arrange();

      await expect(
        eventEmitter.emitAsync(
          UserRoleChangedEvent.name,
          new UserRoleChangedEvent('user-789')
        )
      ).rejects.toThrow('db down');
    }
  );
});
