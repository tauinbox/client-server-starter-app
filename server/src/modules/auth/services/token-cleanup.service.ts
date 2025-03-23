import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RefreshTokenService } from './refresh-token.service';

@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(private refreshTokenService: RefreshTokenService) {}

  // Remove expired refresh tokens daily at midnight
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyTokenCleanup() {
    this.logger.log('Starting scheduled cleanup of expired refresh tokens');

    try {
      const countBefore = await this.refreshTokenService.countExpiredTokens();

      await this.refreshTokenService.removeExpiredTokens();

      this.logger.log(
        `Successfully removed ${countBefore} expired refresh tokens`
      );
    } catch (error) {
      this.logger.error('Error during token cleanup:', error);
    }
  }

  // Additional cleanup during light load hours to keep the database optimized
  // Runs every Sunday at 2:00 AM
  @Cron('0 2 * * 0')
  async handleWeeklyMaintenance() {
    this.logger.log('Starting weekly token maintenance task');

    try {
      await this.refreshTokenService.removeRevokedAndExpiredTokens();

      this.logger.log('Weekly token maintenance completed successfully');
    } catch (error) {
      this.logger.error('Error during weekly token maintenance:', error);
    }
  }
}
