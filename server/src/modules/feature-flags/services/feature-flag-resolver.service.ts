import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import KeyvRedis, { type RedisClientConnectionType } from '@keyv/redis';
import type { Cache } from 'cache-manager';
import type { Request } from 'express';
import { In, Repository } from 'typeorm';
import {
  evaluateFeatureFlag,
  type EvaluatorFlag,
  type EvaluatorRule,
  type FeatureFlagEvaluationContext
} from '@app/shared/utils/feature-flag-evaluator';
import type { EvaluatedFeatureFlagsResponse } from '@app/shared/types';
import { FeatureFlag } from '../entities/feature-flag.entity';
import { FeatureFlagRule } from '../entities/feature-flag-rule.entity';
import { AttributeRegistryService } from './attribute-registry.service';
import { PermissionService } from '../../auth/services/permission.service';
import { UsersService } from '../../users/services/users.service';
import { MetricsService } from '../../core/metrics/metrics.service';

export interface ResolverUser {
  userId: string;
  email: string | null;
  createdAt: Date | null;
  roles: string[];
}

interface CachedFlag {
  id: string;
  key: string;
  enabled: boolean;
  environments: string[];
  public: boolean;
  rules: {
    type: FeatureFlagRule['type'];
    effect: FeatureFlagRule['effect'];
    payload: FeatureFlagRule['payload'];
  }[];
}

const ALL_FLAGS_KEY = 'featureflags:all';
const VERSION_KEY = 'featureflags:version';
// Read and written with the raw Redis client rather than through cache-manager:
// Keyv stores every value inside a JSON envelope, which INCR cannot operate on.
// Kept separate from VERSION_KEY so the two representations never collide.
const VERSION_COUNTER_KEY = 'featureflags:version:counter';
const ALL_FLAGS_TTL_MS = 300_000;
const USER_FLAGS_TTL_MS = 60_000;
const COUNTER_ERROR_LOG_THROTTLE_MS = 30_000;

@Injectable()
export class FeatureFlagResolverService {
  #loadAllInFlight: Promise<CachedFlag[]> | null = null;
  #loadAllGeneration = 0;
  readonly #logger = new Logger(FeatureFlagResolverService.name);
  #counterErrorLoggedAt = 0;

  constructor(
    @InjectRepository(FeatureFlag)
    private readonly flagRepo: Repository<FeatureFlag>,
    @InjectRepository(FeatureFlagRule)
    private readonly ruleRepo: Repository<FeatureFlagRule>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly attributeRegistry: AttributeRegistryService,
    private readonly configService: ConfigService,
    private readonly permissionService: PermissionService,
    private readonly usersService: UsersService,
    private readonly metrics: MetricsService
  ) {}

  /**
   * Assembles the evaluation context for a user id: looks up the user record
   * (tolerating an orphaned token whose user no longer exists) and their role
   * names. Single source for the wiring shared by the controller and guard.
   */
  async buildResolverUser(userId: string): Promise<ResolverUser> {
    const [user, roles] = await Promise.all([
      this.usersService.findOne(userId).catch(() => null),
      this.permissionService.getRoleNamesForUser(userId)
    ]);
    return {
      userId,
      email: user?.email ?? null,
      createdAt: user?.createdAt ?? null,
      roles
    };
  }

  async evaluateForUser(
    user: ResolverUser,
    req: Request
  ): Promise<EvaluatedFeatureFlagsResponse> {
    const version = await this.getVersion();
    const cacheKey = `featureflags:user:${user.userId}:v${version}`;
    const cached =
      await this.cacheManager.get<EvaluatedFeatureFlagsResponse>(cacheKey);
    this.metrics.recordCacheAccess('feature_flags', cached ? 'hit' : 'miss');
    if (cached) return cached;

    const flags = await this.loadAllFlags();
    const ctx = this.buildContext(user, null, req);
    const result = this.evaluate(flags, ctx, /* publicOnly */ false);
    await this.cacheManager.set(cacheKey, result, USER_FLAGS_TTL_MS);
    return result;
  }

  async evaluateAnonymous(
    anonId: string | null,
    req: Request
  ): Promise<EvaluatedFeatureFlagsResponse> {
    const flags = await this.loadAllFlags();
    const ctx = this.buildContext(null, anonId, req);
    return this.evaluate(flags, ctx, /* publicOnly */ true);
  }

  async isEnabledForUser(
    user: ResolverUser,
    req: Request,
    key: string
  ): Promise<boolean> {
    const evaluated = await this.evaluateForUser(user, req);
    return evaluated.flags[key] === true;
  }

  /**
   * Invalidates the cached flag list. Per-user caches are keyed by the global
   * version counter, so they orphan naturally without an explicit SCAN+DEL.
   */
  async invalidateAll(): Promise<void> {
    // A load that started before this invalidation holds pre-change rows: bump
    // the generation so its cache write is skipped, and detach the in-flight
    // promise so the next miss starts a fresh DB load.
    this.#loadAllGeneration++;
    this.#loadAllInFlight = null;
    await this.cacheManager.del(ALL_FLAGS_KEY);
    await this.bumpVersion();
  }

  async invalidateUser(userId: string): Promise<void> {
    const version = await this.getVersion();
    await this.cacheManager.del(`featureflags:user:${userId}:v${version}`);
  }

  private async loadAllFlags(): Promise<CachedFlag[]> {
    const cached = await this.cacheManager.get<CachedFlag[]>(ALL_FLAGS_KEY);
    this.metrics.recordCacheAccess(
      'feature_flags_all',
      cached ? 'hit' : 'miss'
    );
    if (cached) return cached;

    // Single-flight: the flag-change broadcast triggers a synchronized refetch
    // from every connected client, so concurrent misses must share one DB load
    // instead of stampeding the flags table.
    if (!this.#loadAllInFlight) {
      const load = this.#loadAllFlagsFromDb().finally(() => {
        if (this.#loadAllInFlight === load) this.#loadAllInFlight = null;
      });
      this.#loadAllInFlight = load;
    }
    return this.#loadAllInFlight;
  }

  async #loadAllFlagsFromDb(): Promise<CachedFlag[]> {
    const generation = this.#loadAllGeneration;
    const flags = await this.flagRepo.find({ order: { key: 'ASC' } });
    if (flags.length === 0) {
      if (generation === this.#loadAllGeneration) {
        await this.cacheManager.set(ALL_FLAGS_KEY, [], ALL_FLAGS_TTL_MS);
      }
      return [];
    }
    const rules = await this.ruleRepo.find({
      where: { flagId: In(flags.map((f) => f.id)) },
      order: { createdAt: 'ASC', id: 'ASC' }
    });
    const rulesByFlag = new Map<string, typeof rules>();
    for (const r of rules) {
      const arr = rulesByFlag.get(r.flagId) ?? [];
      arr.push(r);
      rulesByFlag.set(r.flagId, arr);
    }
    const projected: CachedFlag[] = flags.map((f) => ({
      id: f.id,
      key: f.key,
      enabled: f.enabled,
      environments: f.environments,
      public: f.public,
      rules: (rulesByFlag.get(f.id) ?? []).map((r) => ({
        type: r.type,
        effect: r.effect,
        payload: r.payload
      }))
    }));
    if (generation === this.#loadAllGeneration) {
      await this.cacheManager.set(ALL_FLAGS_KEY, projected, ALL_FLAGS_TTL_MS);
    }
    return projected;
  }

  private buildContext(
    user: ResolverUser | null,
    anonId: string | null,
    req: Request
  ): FeatureFlagEvaluationContext {
    const env = this.configService.get<string>('ENVIRONMENT') ?? 'production';
    const attributes = this.attributeRegistry.resolveAll(
      user
        ? {
            userId: user.userId,
            email: user.email,
            createdAt: user.createdAt
          }
        : null,
      req
    );
    return {
      userId: user?.userId ?? null,
      anonId,
      roles: user?.roles ?? [],
      attributes,
      env
    };
  }

  private evaluate(
    flags: CachedFlag[],
    ctx: FeatureFlagEvaluationContext,
    publicOnly: boolean
  ): EvaluatedFeatureFlagsResponse {
    const result: Record<string, boolean> = {};
    for (const flag of flags) {
      if (publicOnly && !flag.public) continue;
      const evalFlag: EvaluatorFlag = {
        key: flag.key,
        enabled: flag.enabled,
        environments: flag.environments
      };
      const evalRules: EvaluatorRule[] = flag.rules.map((r) => ({
        effect: r.effect,
        payload: r.payload
      }));
      const value = evaluateFeatureFlag(evalFlag, evalRules, ctx);
      // Authenticated callers receive all flags, but a disabled non-public flag
      // would leak an internal/unfinished feature key. Omit it: the client's
      // isEnabled() treats an absent key as false, so this is transparent.
      if (!publicOnly && !value && !flag.public) continue;
      result[flag.key] = value;
    }
    return {
      flags: result,
      evaluatedAt: new Date().toISOString()
    };
  }

  /**
   * The Redis client behind the cache, or null when the cache is the in-memory
   * fallback (no REDIS_URL) - there a single process owns the counter and the
   * read-modify-write below cannot lose to another instance. Nest wraps the
   * configured adapter in a Keyv, so the adapter sits at `stores[0].store`.
   * Probed defensively because `stores` is an implementation detail of the
   * injected cache: a partial stand-in must degrade, not break evaluation.
   */
  #redisClient(): RedisClientConnectionType | null {
    const store: unknown = this.cacheManager.stores?.[0]?.store;
    return store instanceof KeyvRedis ? store.client : null;
  }

  #logCounterFailure(error: unknown): void {
    const now = Date.now();
    if (now - this.#counterErrorLoggedAt < COUNTER_ERROR_LOG_THROTTLE_MS)
      return;
    this.#counterErrorLoggedAt = now;
    this.#logger.warn(
      `Feature-flag version counter unavailable, falling back to the cache-manager counter: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  private async getVersion(): Promise<number> {
    const redis = this.#redisClient();
    if (redis) {
      try {
        const raw = await redis.get(VERSION_COUNTER_KEY);
        // Nothing invalidated yet, so nothing to orphan: 0 is a valid suffix and
        // skips the initializing write that used to race across instances.
        if (raw === null) return 0;
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) return parsed;
      } catch (error: unknown) {
        this.#logCounterFailure(error);
      }
    }

    const cached = await this.cacheManager.get<number>(VERSION_KEY);
    if (typeof cached === 'number') return cached;
    const initial = Date.now();
    await this.cacheManager.set(VERSION_KEY, initial, 0);
    return initial;
  }

  private async bumpVersion(): Promise<void> {
    const redis = this.#redisClient();
    if (redis) {
      try {
        // Atomic, so simultaneous invalidations across instances cannot read the
        // same previous value and write back the same next one.
        await redis.incr(VERSION_COUNTER_KEY);
        return;
      } catch (error: unknown) {
        this.#logCounterFailure(error);
      }
    }

    // Date.now() has millisecond granularity, so two invalidations inside one
    // millisecond would re-emit the same version and leave stale per-user cache
    // keys reachable; max(prev + 1) keeps the suffix strictly fresh.
    const previous = await this.cacheManager.get<number>(VERSION_KEY);
    const next = Math.max(
      Date.now(),
      (typeof previous === 'number' ? previous : 0) + 1
    );
    await this.cacheManager.set(VERSION_KEY, next, 0);
  }
}
