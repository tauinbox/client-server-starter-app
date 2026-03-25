import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly config: ConfigService) {
    super();
  }

  isHealthy(key: string): HealthIndicatorResult {
    const redisUrl = this.config.get<string>('REDIS_URL');
    const isProduction = this.config.get('ENVIRONMENT') === 'production';
    if (!redisUrl && isProduction) {
      return this.getStatus(key, true, {
        warning:
          'REDIS_URL not set — rate limiting and cache invalidation are per-instance only'
      });
    }
    return this.getStatus(key, true);
  }
}
