import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { UserRoleChangedListener } from './user-role-changed.listener';
import { RefreshTokenService } from '../services/refresh-token.service';
import { PermissionService } from '../services/permission.service';
import { DataSource } from 'typeorm';
import { UserRoleChangedEvent } from '../events/user-role-changed.event';

describe('UserRoleChangedListener', () => {
  let module: TestingModule;
  let eventEmitter: EventEmitter2;
  let refreshTokenService: { deleteByUserId: jest.Mock };
  let permissionService: { invalidateUserCache: jest.Mock };
  let repositoryMock: { update: jest.Mock };

  beforeEach(async () => {
    refreshTokenService = {
      deleteByUserId: jest.fn().mockResolvedValue(undefined)
    };
    permissionService = {
      invalidateUserCache: jest.fn().mockResolvedValue(undefined)
    };
    repositoryMock = { update: jest.fn().mockResolvedValue({}) };

    const dataSource = {
      getRepository: jest.fn().mockReturnValue(repositoryMock)
    };

    module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        UserRoleChangedListener,
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: PermissionService, useValue: permissionService },
        { provide: DataSource, useValue: dataSource }
      ]
    }).compile();

    await module.init();
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should revoke tokens, invalidate cache, and set tokenRevokedAt on role change', async () => {
    const userId = 'user-789';

    await eventEmitter.emitAsync(
      UserRoleChangedEvent.name,
      new UserRoleChangedEvent(userId)
    );

    expect(refreshTokenService.deleteByUserId).toHaveBeenCalledWith(userId);
    expect(repositoryMock.update).toHaveBeenCalledWith(userId, {
      tokenRevokedAt: expect.any(Date) as Date
    });
    expect(permissionService.invalidateUserCache).toHaveBeenCalledWith(userId);
  });

  it.each([
    [
      'refresh token deletion',
      () =>
        refreshTokenService.deleteByUserId.mockRejectedValue(
          new Error('db down')
        )
    ],
    [
      'the tokenRevokedAt stamp',
      () => repositoryMock.update.mockRejectedValue(new Error('db down'))
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
