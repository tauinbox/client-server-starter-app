import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import {
  POOL_LOCK_KEYS,
  runOncePerPool
} from '../../../common/utils/pool-lock.util';
import { RefreshTokenService } from './refresh-token.service';

@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(
    private refreshTokenService: RefreshTokenService,
    private readonly dataSource: DataSource
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'UTC' })
  async handleDailyTokenCleanup() {
    try {
      await runOncePerPool(
        this.dataSource,
        POOL_LOCK_KEYS.refreshTokenCleanup,
        async () => {
          this.logger.log(
            'Starting scheduled cleanup of expired refresh tokens'
          );

          const removed = await this.refreshTokenService.removeExpiredTokens();

          this.logger.log(
            `Successfully removed ${removed} expired refresh tokens`
          );
        }
      );
    } catch (error) {
      this.logger.error('Error during token cleanup:', error);
    }
  }
}
