import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { SessionRevocationListener } from './session-revocation.listener';
import { RefreshTokenService } from '../services/refresh-token.service';
import { UserSessionRevocationRequiredEvent } from '../../users/events/user-session-revocation-required.event';

describe('SessionRevocationListener', () => {
  let module: TestingModule;
  let eventEmitter: EventEmitter2;
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

    module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        SessionRevocationListener,
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: DataSource, useValue: dataSource }
      ]
    }).compile();

    await module.init();
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should delete refresh tokens and stamp tokenRevokedAt', async () => {
    await eventEmitter.emitAsync(
      UserSessionRevocationRequiredEvent.name,
      new UserSessionRevocationRequiredEvent('user-123')
    );

    expect(refreshTokenService.deleteByUserId).toHaveBeenCalledWith('user-123');
    expect(repositoryMock.update).toHaveBeenCalledWith('user-123', {
      tokenRevokedAt: expect.any(Date) as Date
    });
  });

  it('should propagate a failure to the emitter so the caller can fail the request', async () => {
    refreshTokenService.deleteByUserId.mockRejectedValue(new Error('db down'));

    await expect(
      eventEmitter.emitAsync(
        UserSessionRevocationRequiredEvent.name,
        new UserSessionRevocationRequiredEvent('user-123')
      )
    ).rejects.toThrow('db down');
  });
});
