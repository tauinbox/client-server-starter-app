import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  DEPENDENCY_HEALTH_REF,
  DependencyHealthRef
} from '../metrics/dependency-up.gauge';
import {
  REDIS_MEMORY_REF,
  RedisMemoryRef,
  redisMemoryRatio
} from '../metrics/redis-memory.gauge';

const PING_TIMEOUT_MS = 2000;

@Injectable()
export class RedisHealthIndicator implements OnModuleDestroy {
  private client?: Redis;

  constructor(
    private readonly config: ConfigService,
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(DEPENDENCY_HEALTH_REF)
    private readonly dependencyHealth: DependencyHealthRef,
    @Inject(REDIS_MEMORY_REF)
    private readonly redisMemory: RedisMemoryRef
  ) {}

  onModuleDestroy(): void {
    this.client?.disconnect();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const redisUrl = this.config.get<string>('REDIS_URL');

    if (!redisUrl) {
      this.dependencyHealth.statuses.set(key, true);

      return indicator.up();
    }

    try {
      await this.probe(redisUrl);
      this.dependencyHealth.statuses.set(key, true);

      return indicator.up();
    } catch {
      // Fails readiness (unlike SMTP's degrade-with-warning): throttler
      // storage, mail queue and cache invalidation all need Redis. Message
      // stays generic - /health/ready is public.
      this.dependencyHealth.statuses.set(key, false);

      return indicator.down('Redis ping failed');
    }
  }

  private async probe(url: string): Promise<void> {
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
      // A full Redis still answers PING, so only the memory ratio shows it.
      this.redisMemory.ratio = redisMemoryRatio(
        await Promise.race([this.client.info('memory'), timeout])
      );
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
