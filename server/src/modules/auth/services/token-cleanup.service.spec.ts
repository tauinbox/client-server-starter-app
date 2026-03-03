import { Test, TestingModule } from '@nestjs/testing';
import { TokenCleanupService } from './token-cleanup.service';
import { RefreshTokenService } from './refresh-token.service';

describe('TokenCleanupService', () => {
  let service: TokenCleanupService;
  let refreshTokenService: {
    removeExpiredTokens: jest.Mock;
    removeRevokedAndExpiredTokens: jest.Mock;
  };

  beforeEach(async () => {
    refreshTokenService = {
      removeExpiredTokens: jest.fn(),
      removeRevokedAndExpiredTokens: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenCleanupService,
        {
          provide: RefreshTokenService,
          useValue: refreshTokenService
        }
      ]
    }).compile();

    service = module.get<TokenCleanupService>(TokenCleanupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleDailyTokenCleanup', () => {
    it('should remove expired tokens in a single call', async () => {
      refreshTokenService.removeExpiredTokens.mockResolvedValue(15);

      await service.handleDailyTokenCleanup();

      expect(refreshTokenService.removeExpiredTokens).toHaveBeenCalled();
    });

    it('should log the number of removed tokens', async () => {
      refreshTokenService.removeExpiredTokens.mockResolvedValue(42);
      const logSpy = jest.spyOn(service['logger'], 'log');

      await service.handleDailyTokenCleanup();

      expect(logSpy).toHaveBeenCalledWith(
        'Successfully removed 42 expired refresh tokens'
      );
    });

    it('should log zero when no expired tokens exist', async () => {
      refreshTokenService.removeExpiredTokens.mockResolvedValue(0);
      const logSpy = jest.spyOn(service['logger'], 'log');

      await service.handleDailyTokenCleanup();

      expect(logSpy).toHaveBeenCalledWith(
        'Successfully removed 0 expired refresh tokens'
      );
    });

    it('should catch and log errors from removeExpiredTokens', async () => {
      const error = new Error('Delete failed');
      refreshTokenService.removeExpiredTokens.mockRejectedValue(error);
      const errorSpy = jest.spyOn(service['logger'], 'error');

      await service.handleDailyTokenCleanup();

      expect(errorSpy).toHaveBeenCalledWith(
        'Error during token cleanup:',
        error
      );
    });
  });

  describe('handleWeeklyMaintenance', () => {
    it('should remove revoked and expired tokens', async () => {
      refreshTokenService.removeRevokedAndExpiredTokens.mockResolvedValue(
        undefined
      );

      await service.handleWeeklyMaintenance();

      expect(
        refreshTokenService.removeRevokedAndExpiredTokens
      ).toHaveBeenCalled();
    });

    it('should log start and completion messages', async () => {
      refreshTokenService.removeRevokedAndExpiredTokens.mockResolvedValue(
        undefined
      );
      const logSpy = jest.spyOn(service['logger'], 'log');

      await service.handleWeeklyMaintenance();

      expect(logSpy).toHaveBeenCalledWith(
        'Starting weekly token maintenance task'
      );
      expect(logSpy).toHaveBeenCalledWith(
        'Weekly token maintenance completed successfully'
      );
    });

    it('should catch and log errors', async () => {
      const error = new Error('Maintenance failed');
      refreshTokenService.removeRevokedAndExpiredTokens.mockRejectedValue(
        error
      );
      const errorSpy = jest.spyOn(service['logger'], 'error');

      await service.handleWeeklyMaintenance();

      expect(errorSpy).toHaveBeenCalledWith(
        'Error during weekly token maintenance:',
        error
      );
    });

    it('should not throw when an error occurs', async () => {
      refreshTokenService.removeRevokedAndExpiredTokens.mockRejectedValue(
        new Error('fail')
      );

      await expect(service.handleWeeklyMaintenance()).resolves.toBeUndefined();
    });
  });
});
