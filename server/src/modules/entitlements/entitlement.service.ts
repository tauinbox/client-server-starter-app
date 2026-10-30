import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Cache } from 'cache-manager';
import { In, IsNull, Repository } from 'typeorm';
import type { EntitlementLimitKey } from '@app/shared/types';
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@app/shared/constants';
import { CacheVersionCounter } from '../../common/utils/cache-version-counter';
import { MetricsService } from '../core/metrics/metrics.service';
import { Customer } from '../billing/entities/customer.entity';
import { CustomerGrant } from '../billing/entities/customer-grant.entity';
import { Plan } from '../billing/entities/plan.entity';
import { Subscription } from '../billing/entities/subscription.entity';
import {
  FREE_PLAN_KEY,
  type EntitlementCapability,
  type ResolvedEntitlements
} from './entitlement.types';

const USER_VERSION_KEY = 'entitlements:user-version';
const USER_VERSION_COUNTER_KEY = 'entitlements:user-version:counter';
const USER_TTL_MS = 60_000;

@Injectable()
export class EntitlementService {
  readonly #logger = new Logger(EntitlementService.name);
  readonly #userVersion: CacheVersionCounter;

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
    this.#userVersion = new CacheVersionCounter(
      cache,
      USER_VERSION_COUNTER_KEY,
      USER_VERSION_KEY,
      this.#logger
    );
  }

  /**
   * Resolves the capability set + limits in effect for a user. Cached per-user,
   * keyed by a per-user version so a subscription change (`invalidateUser`)
   * orphans the key a concurrent read is about to write. A plan edit in the
   * seeder reaches a cached user when the entry expires (`USER_TTL_MS`).
   */
  async capabilitiesFor(userId: string): Promise<ResolvedEntitlements> {
    const userVersion = await this.#userVersion.read(userId);
    const cacheKey = `entitlements:user:${userId}:u${userVersion}`;
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

  /**
   * The numeric allowance the user's plan carries under `key`, or `null` when
   * the plan sets none — the caller then applies its own default. Reads the
   * already-resolved limits, so it rides the same per-user cache as `has()`
   * and costs no extra query.
   */
  async limitFor(
    userId: string,
    key: EntitlementLimitKey
  ): Promise<number | null> {
    const { limits } = await this.capabilitiesFor(userId);
    return limits[key] ?? null;
  }

  /** Drops the cached entitlements for a single user (subscription change). */
  async invalidateUser(userId: string): Promise<void> {
    await this.#userVersion.bump(userId);
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
    // The drop to Free happens on the `past_due -> canceled` transition, not on
    // entering `past_due` — the dunning grace window keeps full entitlements.
    const subscription = await this.subscriptions.findOne({
      where: { customerId, status: In([...ENTITLED_SUBSCRIPTION_STATUSES]) },
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
}
