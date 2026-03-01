import { Test, TestingModule } from '@nestjs/testing';
import { UserDeletedListener } from './user-deleted.listener';
import { RefreshTokenService } from '../services/refresh-token.service';
import { DataSource } from 'typeorm';
import { UserDeletedEvent } from '../../users/events/user-deleted.event';

describe('UserDeletedListener', () => {
  let listener: UserDeletedListener;
  let refreshTokenService: { deleteByUserId: jest.Mock };
  let repositoryMock: { update: jest.Mock };

  beforeEach(async () => {
    refreshTokenService = {
      deleteByUserId: jest.fn().mockResolvedValue(undefined)
    };
    repositoryMock = { update: jest.fn().mockResolvedValue({}) };

    const dataSource = {
      getRepository: jest.fn().mockReturnValue(repositoryMock)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserDeletedListener,
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: DataSource, useValue: dataSource }
      ]
    }).compile();

    listener = module.get<UserDeletedListener>(UserDeletedListener);
  });

  it('should delete refresh tokens and revoke the user session on UserDeletedEvent', async () => {
    const userId = 'user-123';
    const event = new UserDeletedEvent(userId);

    await listener.handle(event);

    expect(refreshTokenService.deleteByUserId).toHaveBeenCalledWith(userId);
    expect(repositoryMock.update).toHaveBeenCalledWith(userId, {
      tokenRevokedAt: expect.any(Date) as Date
    });
  });
});
