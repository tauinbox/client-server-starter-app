import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
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
const ALL_FLAGS_TTL_MS = 300_000;
const USER_FLAGS_TTL_MS = 60_000;

@Injectable()
export class FeatureFlagResolverService {
  constructor(
    @InjectRepository(FeatureFlag)
    private readonly flagRepo: Repository<FeatureFlag>,
    @InjectRepository(FeatureFlagRule)
    private readonly ruleRepo: Repository<FeatureFlagRule>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly attributeRegistry: AttributeRegistryService,
    private readonly configService: ConfigService
  ) {}

  async evaluateForUser(
    user: ResolverUser,
    req: Request
  ): Promise<EvaluatedFeatureFlagsResponse> {
    const version = await this.getVersion();
    const cacheKey = `featureflags:user:${user.userId}:v${version}`;
    const cached =
      await this.cacheManager.get<EvaluatedFeatureFlagsResponse>(cacheKey);
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
    await this.cacheManager.del(ALL_FLAGS_KEY);
    await this.bumpVersion();
  }

  async invalidateUser(userId: string): Promise<void> {
    const version = await this.getVersion();
    await this.cacheManager.del(`featureflags:user:${userId}:v${version}`);
  }

  private async loadAllFlags(): Promise<CachedFlag[]> {
    const cached = await this.cacheManager.get<CachedFlag[]>(ALL_FLAGS_KEY);
    if (cached) return cached;

    const flags = await this.flagRepo.find({ order: { key: 'ASC' } });
    if (flags.length === 0) {
      await this.cacheManager.set(ALL_FLAGS_KEY, [], ALL_FLAGS_TTL_MS);
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
    await this.cacheManager.set(ALL_FLAGS_KEY, projected, ALL_FLAGS_TTL_MS);
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

  private async getVersion(): Promise<number> {
    const cached = await this.cacheManager.get<number>(VERSION_KEY);
    if (typeof cached === 'number') return cached;
    const initial = Date.now();
    await this.cacheManager.set(VERSION_KEY, initial, 0);
    return initial;
  }

  private async bumpVersion(): Promise<void> {
    // Monotonically increasing — Date.now() alone has millisecond granularity,
    // and two invalidations inside the same millisecond (fast CI hardware,
    // multi-instance race) would re-emit the same version and leave stale
    // per-user cache keys reachable. Guarding with max(prev + 1) keeps the
    // suffix strictly fresh.
    const previous = await this.cacheManager.get<number>(VERSION_KEY);
    const next = Math.max(
      Date.now(),
      (typeof previous === 'number' ? previous : 0) + 1
    );
    await this.cacheManager.set(VERSION_KEY, next, 0);
  }
}
