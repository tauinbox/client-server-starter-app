import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Cache } from 'cache-manager';
import { In, IsNull, Repository } from 'typeorm';
import type { EntitlementLimitKey } from '@app/shared/types';
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  FREE_PLAN_KEY,
  PAY_AS_YOU_GO_PLAN_KEY
} from '@app/shared/constants';
import { entitlementsOfPlan } from '@app/shared/utils/billing-rules';
import { CacheVersionCounter } from '../../common/utils/cache-version-counter';
import { MetricsService } from '../core/metrics/metrics.service';
import { CreditBalance } from '../billing/entities/credit-balance.entity';
import { Customer } from '../billing/entities/customer.entity';
import { CustomerGrant } from '../billing/entities/customer-grant.entity';
import { Plan } from '../billing/entities/plan.entity';
import { Subscription } from '../billing/entities/subscription.entity';
import type {
  EntitlementCapability,
  ResolvedEntitlements
} from './entitlement.types';

const USER_VERSION_KEY = 'entitlements:user-version';
const USER_VERSION_COUNTER_KEY = 'entitlements:user-version:counter';
// A change of the plans or products drops every entry. Stored in the entry,
// not in the key, so a failed per-user bump still knows its keys.
const CATALOG_VERSION_KEY = 'entitlements:catalog-version';
const CATALOG_VERSION_COUNTER_KEY = 'entitlements:catalog-version:counter';
const USER_TTL_MS = 60_000;

interface CachedEntitlements {
  catalog: number;
  value: ResolvedEntitlements;
}

function userCacheKey(userId: string, version: number): string {
  return `entitlements:user:v2:${userId}:u${version}`;
}

@Injectable()
export class EntitlementService {
  readonly #logger = new Logger(EntitlementService.name);
  readonly #userVersion: CacheVersionCounter<string>;
  readonly #catalogVersion: CacheVersionCounter;

  constructor(
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Plan)
    private readonly plans: Repository<Plan>,
    @InjectRepository(CustomerGrant)
    private readonly grants: Repository<CustomerGrant>,
    @InjectRepository(CreditBalance)
    private readonly balances: Repository<CreditBalance>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly metrics: MetricsService
  ) {
    this.#userVersion = new CacheVersionCounter<string>(cache, {
      counterKey: USER_VERSION_COUNTER_KEY,
      fallbackKey: USER_VERSION_KEY,
      logger: this.#logger,
      entryKeys: (version, userId) => [userCacheKey(userId, version)]
    });
    // No key to delete when its INCR fails: the entries stay until their TTL,
    // and the failure is logged (MR-D1).
    this.#catalogVersion = new CacheVersionCounter(cache, {
      counterKey: CATALOG_VERSION_COUNTER_KEY,
      fallbackKey: CATALOG_VERSION_KEY,
      logger: this.#logger,
      entryKeys: () => []
    });
  }

  /**
   * Resolves the capability set + limits in effect for a user. Cached per-user,
   * keyed by a per-user version so a subscription change (`invalidateUser`)
   * orphans the key a concurrent read is about to write. A change of the plans
   * or products reaches every cached user through the settings change log
   * (`invalidateCatalog`).
   */
  async capabilitiesFor(userId: string): Promise<ResolvedEntitlements> {
    const [userVersion, catalog] = await Promise.all([
      this.#userVersion.read(userId),
      this.#catalogVersion.read()
    ]);
    const cacheKey = userCacheKey(userId, userVersion);
    const cached = await this.cache.get<CachedEntitlements>(cacheKey);
    const hit = cached?.catalog === catalog;

    this.metrics.recordCacheAccess('entitlements', hit ? 'hit' : 'miss');

    if (cached && hit) return cached.value;

    const resolved = await this.resolve(userId);

    await this.cache.set(
      cacheKey,
      { catalog, value: resolved } satisfies CachedEntitlements,
      USER_TTL_MS
    );

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

  /** Drops the cached entitlements of every user (plans or products changed). */
  async invalidateCatalog(): Promise<void> {
    await this.#catalogVersion.bump();
  }

  /**
   * The entitled subscription of the customer and its plan, or null when there
   * is none. The drop to Free happens on the `past_due -> canceled`
   * transition, not on entering `past_due`: the dunning grace window keeps
   * full entitlements.
   */
  async entitledSubscription(
    customerId: string
  ): Promise<{ subscriptionId: string; plan: ResolvedEntitlements } | null> {
    const subscription = await this.subscriptions.findOne({
      where: { customerId, status: In([...ENTITLED_SUBSCRIPTION_STATUSES]) },
      order: { createdAt: 'DESC' }
    });
    const plan = subscription
      ? await this.plans.findOne({ where: { key: subscription.planKey } })
      : null;

    return subscription && plan
      ? { subscriptionId: subscription.id, plan: entitlementsOfPlan(plan) }
      : null;
  }

  /**
   * The base tier (an entitled subscription, else a positive credit balance as
   * pay as you go, else Free) unioned with active one-time purchase grants: a
   * paid sku unlocks its entitlement on top of whatever tier the user is on,
   * including Free.
   */
  private async resolve(userId: string): Promise<ResolvedEntitlements> {
    const customer = await this.customers.findOne({ where: { userId } });

    if (!customer) return this.freeEntitlements();

    const base =
      (await this.entitledSubscription(customer.id))?.plan ??
      (await this.payAsYouGoPlan(customer.id)) ??
      (await this.freeEntitlements());
    const granted = await this.activeGrantEntitlements(customer.id);

    if (granted.length === 0) return base;

    return {
      ...base,
      capabilities: [...new Set([...base.capabilities, ...granted])]
    };
  }

  /** The pay-as-you-go plan while the credit balance is above 0. */
  private async payAsYouGoPlan(
    customerId: string
  ): Promise<ResolvedEntitlements | null> {
    const balance = await this.balances.findOne({ where: { customerId } });

    if (!balance || balance.balanceUnits.toNumber() <= 0) return null;

    const plan = await this.plans.findOne({
      where: { key: PAY_AS_YOU_GO_PLAN_KEY }
    });

    return plan ? entitlementsOfPlan(plan) : null;
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
      ? entitlementsOfPlan(free)
      : { planKey: FREE_PLAN_KEY, capabilities: [], limits: {} };
  }
}
