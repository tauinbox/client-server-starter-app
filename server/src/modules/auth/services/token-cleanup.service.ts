import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RefreshTokenService } from './refresh-token.service';

@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(private refreshTokenService: RefreshTokenService) {}

  // Remove expired refresh tokens daily at midnight
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'UTC' })
  async handleDailyTokenCleanup() {
    this.logger.log('Starting scheduled cleanup of expired refresh tokens');

    try {
      const removed = await this.refreshTokenService.removeExpiredTokens();

      this.logger.log(`Successfully removed ${removed} expired refresh tokens`);
    } catch (error) {
      this.logger.error('Error during token cleanup:', error);
    }
  }
}
