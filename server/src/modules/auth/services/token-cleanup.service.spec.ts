import { Test, TestingModule } from '@nestjs/testing';
import { TokenCleanupService } from './token-cleanup.service';
import { RefreshTokenService } from './refresh-token.service';

describe('TokenCleanupService', () => {
  let service: TokenCleanupService;
  let refreshTokenService: {
    removeExpiredTokens: jest.Mock;
  };

  beforeEach(async () => {
    refreshTokenService = {
      removeExpiredTokens: jest.fn()
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

  describe('cron schedule', () => {
    // The cleanup cron fires at a fixed wall-clock time (midnight).
    // Pinning the job timezone to UTC keeps it zone-independent regardless of
    // the host's TZ, so the schedule never silently shifts across deployments.
    const getCronTimeZone = (methodName: keyof TokenCleanupService) => {
      const method = Object.getOwnPropertyDescriptor(
        TokenCleanupService.prototype,
        methodName
      )?.value as object;
      const options = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', method) as {
        timeZone?: string;
      };
      return options.timeZone;
    };

    it('runs the daily token cleanup in UTC', () => {
      expect(getCronTimeZone('handleDailyTokenCleanup')).toBe('UTC');
    });
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
});
