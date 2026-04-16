import { Test, TestingModule } from '@nestjs/testing';
import { UserRoleChangedListener } from './user-role-changed.listener';
import { RefreshTokenService } from '../services/refresh-token.service';
import { PermissionService } from '../services/permission.service';
import { DataSource } from 'typeorm';
import { UserRoleChangedEvent } from '../events/user-role-changed.event';

describe('UserRoleChangedListener', () => {
  let listener: UserRoleChangedListener;
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRoleChangedListener,
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: PermissionService, useValue: permissionService },
        { provide: DataSource, useValue: dataSource }
      ]
    }).compile();

    listener = module.get<UserRoleChangedListener>(UserRoleChangedListener);
  });

  it('should revoke tokens, invalidate cache, and set tokenRevokedAt on role change', async () => {
    const userId = 'user-789';
    const event = new UserRoleChangedEvent(userId);

    await listener.handleUserRoleChanged(event);

    expect(refreshTokenService.deleteByUserId).toHaveBeenCalledWith(userId);
    expect(repositoryMock.update).toHaveBeenCalledWith(userId, {
      tokenRevokedAt: expect.any(Date) as Date
    });
    expect(permissionService.invalidateUserCache).toHaveBeenCalledWith(userId);
  });
});
