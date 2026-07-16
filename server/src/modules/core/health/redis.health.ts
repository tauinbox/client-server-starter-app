import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const PING_TIMEOUT_MS = 2000;

@Injectable()
export class RedisHealthIndicator implements OnModuleDestroy {
  private client?: Redis;

  constructor(
    private readonly config: ConfigService,
    private readonly healthIndicatorService: HealthIndicatorService
  ) {}

  onModuleDestroy(): void {
    this.client?.disconnect();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      if (this.config.get('ENVIRONMENT') === 'production') {
        return indicator.up({
          warning:
            'REDIS_URL not set — rate limiting and cache invalidation are per-instance only'
        });
      }
      return indicator.up();
    }
    try {
      await this.ping(redisUrl);
      return indicator.up();
    } catch {
      // Fails readiness (unlike SMTP's degrade-with-warning): throttler
      // storage, mail queue and cache invalidation all need Redis. Message
      // stays generic - /health/ready is public.
      return indicator.down('Redis ping failed');
    }
  }

  private async ping(url: string): Promise<void> {
    this.client ??= this.createClient(url);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Redis ping timed out')),
        PING_TIMEOUT_MS
      );
    });
    try {
      await Promise.race([this.client.ping(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private createClient(url: string): Redis {
    const client = new Redis(url, {
      lazyConnect: true,
      connectTimeout: PING_TIMEOUT_MS,
      maxRetriesPerRequest: 1
    });
    // No 'error' listener would turn connection errors into uncaught exceptions
    client.on('error', () => undefined);
    return client;
  }
}
