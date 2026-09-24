import { randomUUID } from 'node:crypto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Cache } from 'cache-manager';
import type { Request } from 'express';
import { In, Repository } from 'typeorm';
import {
  anonymousEvaluationNeedsAnonId,
  evaluateFeatureFlag,
  signedInEvaluationNeedsAnonId,
  type EvaluatorFlag,
  type EvaluatorRule,
  type FeatureFlagEvaluationContext
} from '@app/shared/utils/feature-flag-evaluator';
import type { EvaluatedFeatureFlagsResponse } from '@app/shared/types';
import { CacheVersionCounter } from '../../../common/utils/cache-version-counter';
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

export interface RolloutEvaluation {
  result: EvaluatedFeatureFlagsResponse;
  // Set only when this evaluation minted the rollout id; the caller persists it.
  issuedAnonId: string | null;
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
const VERSION_COUNTER_KEY = 'featureflags:version:counter';
const ALL_FLAGS_TTL_MS = 300_000;
const USER_FLAGS_TTL_MS = 60_000;

@Injectable()
export class FeatureFlagResolverService {
  #loadAllInFlight: Promise<CachedFlag[]> | null = null;
  #loadAllGeneration = 0;
  readonly #logger = new Logger(FeatureFlagResolverService.name);
  readonly #version: CacheVersionCounter;

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
  ) {
    this.#version = new CacheVersionCounter(
      cacheManager,
      VERSION_COUNTER_KEY,
      VERSION_KEY,
      this.#logger
    );
  }

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

  /**
   * Evaluates every flag for a signed-in caller. The rollout id is read, and
   * minted when absent, only while a live rule buckets by `device`. That map
   * depends on the browser, so it skips the per-user cache: `invalidateUser`
   * could not reach one cache entry per device.
   */
  async evaluateSignedIn(
    user: ResolverUser,
    anonId: string | null,
    req: Request
  ): Promise<RolloutEvaluation> {
    const flags = await this.loadAllFlags();
    if (!signedInEvaluationNeedsAnonId(flags, this.env())) {
      return {
        result: await this.evaluateForUser(user, req),
        issuedAnonId: null
      };
    }
    const issuedAnonId = anonId === null ? randomUUID() : null;
    const ctx = this.buildContext(user, anonId ?? issuedAnonId, req);
    return {
      result: this.evaluate(flags, ctx, /* publicOnly */ false),
      issuedAnonId
    };
  }

  /**
   * Evaluates every flag for a user with no rollout id, so a rule bucketed by
   * `device` never matches here and a server gate built on it stays closed.
   */
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

  /**
   * Evaluates the public flags for a visitor. `anonId` is the visitor's valid
   * rollout id or null; a new one is minted only when a percentage rule would
   * read it, so no identifier is handed out that nothing uses.
   */
  async evaluateAnonymous(
    anonId: string | null,
    req: Request
  ): Promise<RolloutEvaluation> {
    const flags = await this.loadAllFlags();
    const issuedAnonId =
      anonId === null && anonymousEvaluationNeedsAnonId(flags, this.env())
        ? randomUUID()
        : null;
    const ctx = this.buildContext(null, anonId ?? issuedAnonId, req);
    return {
      result: this.evaluate(flags, ctx, /* publicOnly */ true),
      issuedAnonId
    };
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
    const env = this.env();
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

  private env(): string {
    return this.configService.get<string>('ENVIRONMENT') ?? 'production';
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

  private getVersion(): Promise<number> {
    return this.#version.read();
  }

  private bumpVersion(): Promise<void> {
    return this.#version.bump();
  }
}
