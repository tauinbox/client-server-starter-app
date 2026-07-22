import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Cache } from 'cache-manager';
import { In, IsNull, Repository } from 'typeorm';
import type { SubscriptionStatus } from '@app/shared/types';
import { CacheVersionCounter } from '../../../common/utils/cache-version-counter';
import { MetricsService } from '../../core/metrics/metrics.service';
import { Customer } from '../entities/customer.entity';
import { CustomerGrant } from '../entities/customer-grant.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import {
  FREE_PLAN_KEY,
  type EntitlementCapability,
  type ResolvedEntitlements
} from './entitlement.types';

/**
 * Statuses that keep full entitlements: `active`/`trialing`, plus
 * `past_due` through the dunning grace window. The drop to Free happens on the
 * `past_due → canceled` transition, not on entering `past_due`.
 */
const ENTITLED_STATUSES: SubscriptionStatus[] = [
  'active',
  'trialing',
  'past_due'
];

const VERSION_KEY = 'entitlements:version';
const VERSION_COUNTER_KEY = 'entitlements:version:counter';
const USER_TTL_MS = 60_000;

@Injectable()
export class EntitlementService {
  readonly #logger = new Logger(EntitlementService.name);
  readonly #version: CacheVersionCounter;

  constructor(
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Plan)
    private readonly plans: Repository<Plan>,
    @InjectRepository(CustomerGrant)
    private readonly grants: Repository<CustomerGrant>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly metrics: MetricsService
  ) {
    this.#version = new CacheVersionCounter(
      cache,
      VERSION_COUNTER_KEY,
      VERSION_KEY,
      this.#logger
    );
  }

  /**
   * Resolves the capability set + limits in effect for a user. Cached per-user,
   * keyed by a monotonic global version so a plan-level change (`invalidateAll`)
   * orphans every user key at once without a SCAN+DEL.
   */
  async capabilitiesFor(userId: string): Promise<ResolvedEntitlements> {
    const version = await this.getVersion();
    const cacheKey = `entitlements:user:${userId}:v${version}`;
    const cached = await this.cache.get<ResolvedEntitlements>(cacheKey);
    this.metrics.recordCacheAccess('entitlements', cached ? 'hit' : 'miss');
    if (cached) return cached;

    const resolved = await this.resolve(userId);
    await this.cache.set(cacheKey, resolved, USER_TTL_MS);
    return resolved;
  }

  async has(
    userId: string,
    capability: EntitlementCapability
  ): Promise<boolean> {
    const { capabilities } = await this.capabilitiesFor(userId);
    return capabilities.includes(capability);
  }

  /** Drops the cached entitlements for a single user (subscription change). */
  async invalidateUser(userId: string): Promise<void> {
    const version = await this.getVersion();
    await this.cache.del(`entitlements:user:${userId}:v${version}`);
  }

  /** Bumps the version so every per-user cache key orphans (plan edits). */
  async invalidateAll(): Promise<void> {
    await this.bumpVersion();
  }

  /**
   * Plan capabilities unioned with active one-time purchase grants: a paid
   * sku unlocks its entitlement on top of whatever tier the user is on —
   * including Free.
   */
  private async resolve(userId: string): Promise<ResolvedEntitlements> {
    const customer = await this.customers.findOne({ where: { userId } });
    const base = customer
      ? await this.subscriptionEntitlements(customer.id)
      : await this.freeEntitlements();
    if (!customer) return base;

    const granted = await this.activeGrantEntitlements(customer.id);
    if (granted.length === 0) return base;
    return {
      ...base,
      capabilities: [...new Set([...base.capabilities, ...granted])]
    };
  }

  private async subscriptionEntitlements(
    customerId: string
  ): Promise<ResolvedEntitlements> {
    const subscription = await this.subscriptions.findOne({
      where: { customerId, status: In(ENTITLED_STATUSES) },
      order: { createdAt: 'DESC' }
    });
    if (subscription) {
      const plan = await this.plans.findOne({
        where: { key: subscription.planKey }
      });
      if (plan) return this.toResolved(plan);
    }
    return this.freeEntitlements();
  }

  /** Entitlements from non-revoked, non-expired one-time purchase grants. */
  private async activeGrantEntitlements(customerId: string): Promise<string[]> {
    const grants = await this.grants.find({
      where: { customerId, revokedAt: IsNull() }
    });
    const now = Date.now();
    return grants
      .filter((grant) => !grant.expiresAt || grant.expiresAt.getTime() > now)
      .map((grant) => grant.entitlement);
  }

  private async freeEntitlements(): Promise<ResolvedEntitlements> {
    const free = await this.plans.findOne({ where: { key: FREE_PLAN_KEY } });
    return free
      ? this.toResolved(free)
      : { planKey: FREE_PLAN_KEY, capabilities: [], limits: {} };
  }

  private toResolved(plan: Plan): ResolvedEntitlements {
    return {
      planKey: plan.key,
      capabilities: plan.entitlements,
      limits: plan.limits ?? {}
    };
  }

  private getVersion(): Promise<number> {
    return this.#version.read();
  }

  private bumpVersion(): Promise<void> {
    return this.#version.bump();
  }
}
