import { Test, TestingModule } from '@nestjs/testing';
import { UserDeletedListener } from './user-deleted.listener';
import { DataSource } from 'typeorm';
import { UserDeletedEvent } from '../../users/events/user-deleted.event';

describe('UserDeletedListener', () => {
  let listener: UserDeletedListener;
  let repositoryMock: { update: jest.Mock };

  beforeEach(async () => {
    repositoryMock = { update: jest.fn().mockResolvedValue({}) };

    const dataSource = {
      getRepository: jest.fn().mockReturnValue(repositoryMock)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserDeletedListener,
        { provide: DataSource, useValue: dataSource }
      ]
    }).compile();

    listener = module.get<UserDeletedListener>(UserDeletedListener);
  });

  it('should clear the pending email-change fields on UserDeletedEvent', async () => {
    const userId = 'user-123';

    await listener.handleUserDeleted(new UserDeletedEvent(userId));

    expect(repositoryMock.update).toHaveBeenCalledWith(userId, {
      pendingEmail: null,
      pendingEmailToken: null,
      pendingEmailExpiresAt: null
    });
  });
});
