import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { In } from 'typeorm';
import type { SubscriptionStatus } from '@app/shared/types';
import { MetricsService } from '../../core/metrics/metrics.service';
import { Customer } from '../entities/customer.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { EntitlementService } from './entitlement.service';
import { FREE_PLAN_KEY } from './entitlement.types';

describe('EntitlementService', () => {
  let service: EntitlementService;
  let customers: { findOne: jest.Mock };
  let subscriptions: { findOne: jest.Mock };
  let plans: { findOne: jest.Mock };
  let cacheStore: Map<string, unknown>;
  let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let metrics: { recordCacheAccess: jest.Mock };

  const PRO_PLAN: Partial<Plan> = {
    key: 'pro',
    entitlements: ['reports', 'api-access', 'data-export'],
    limits: { records: 10000 }
  };
  const FREE_PLAN: Partial<Plan> = {
    key: FREE_PLAN_KEY,
    entitlements: [],
    limits: null
  };

  beforeEach(async () => {
    cacheStore = new Map();
    cache = {
      get: jest.fn((k: string) => Promise.resolve(cacheStore.get(k))),
      set: jest.fn((k: string, v: unknown) => {
        cacheStore.set(k, v);
        return Promise.resolve();
      }),
      del: jest.fn((k: string) => {
        cacheStore.delete(k);
        return Promise.resolve();
      })
    };
    customers = { findOne: jest.fn().mockResolvedValue(null) };
    subscriptions = { findOne: jest.fn().mockResolvedValue(null) };
    plans = { findOne: jest.fn().mockResolvedValue(null) };
    metrics = { recordCacheAccess: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntitlementService,
        { provide: getRepositoryToken(Customer), useValue: customers },
        { provide: getRepositoryToken(Subscription), useValue: subscriptions },
        { provide: getRepositoryToken(Plan), useValue: plans },
        { provide: CACHE_MANAGER, useValue: cache },
        { provide: MetricsService, useValue: metrics }
      ]
    }).compile();

    service = module.get(EntitlementService);
  });

  function withProSubscription(status: SubscriptionStatus): void {
    customers.findOne.mockResolvedValue({ id: 'cust-1', userId: 'user-1' });
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-1',
      customerId: 'cust-1',
      planKey: 'pro',
      status
    });
    plans.findOne.mockResolvedValue(PRO_PLAN);
  }

  describe('capabilitiesFor', () => {
    it.each<SubscriptionStatus>(['active', 'trialing', 'past_due'])(
      'grants the plan entitlements for a %s subscription',
      async (status) => {
        withProSubscription(status);
        const resolved = await service.capabilitiesFor('user-1');
        expect(resolved).toEqual({
          planKey: 'pro',
          capabilities: ['reports', 'api-access', 'data-export'],
          limits: { records: 10000 }
        });
      }
    );

    it('queries only entitled statuses scoped to the customer (no canceled, no IDOR)', async () => {
      customers.findOne.mockResolvedValue({ id: 'cust-1', userId: 'user-1' });
      await service.capabilitiesFor('user-1');
      expect(subscriptions.findOne).toHaveBeenCalledWith({
        where: {
          customerId: 'cust-1',
          status: In(['active', 'trialing', 'past_due'])
        },
        order: { createdAt: 'DESC' }
      });
    });

    it('falls back to the Free plan for a user with no customer record', async () => {
      plans.findOne.mockResolvedValue(FREE_PLAN);
      const resolved = await service.capabilitiesFor('user-1');
      expect(customers.findOne).toHaveBeenCalled();
      expect(subscriptions.findOne).not.toHaveBeenCalled();
      expect(resolved).toEqual({
        planKey: FREE_PLAN_KEY,
        capabilities: [],
        limits: {}
      });
    });

    it('falls back to Free when the customer has no entitled subscription', async () => {
      customers.findOne.mockResolvedValue({ id: 'cust-1', userId: 'user-1' });
      subscriptions.findOne.mockResolvedValue(null);
      plans.findOne.mockResolvedValue(FREE_PLAN);
      const resolved = await service.capabilitiesFor('user-1');
      expect(resolved.planKey).toBe(FREE_PLAN_KEY);
      expect(resolved.capabilities).toEqual([]);
    });

    it('returns an empty capability set when even the Free plan is not seeded', async () => {
      const resolved = await service.capabilitiesFor('user-1');
      expect(resolved).toEqual({
        planKey: FREE_PLAN_KEY,
        capabilities: [],
        limits: {}
      });
    });

    it('serves the second lookup from cache (records hit/miss)', async () => {
      withProSubscription('active');
      await service.capabilitiesFor('user-1');
      await service.capabilitiesFor('user-1');
      expect(customers.findOne).toHaveBeenCalledTimes(1);
      expect(metrics.recordCacheAccess).toHaveBeenNthCalledWith(
        1,
        'entitlements',
        'miss'
      );
      expect(metrics.recordCacheAccess).toHaveBeenNthCalledWith(
        2,
        'entitlements',
        'hit'
      );
    });
  });

  describe('has', () => {
    it('is true for a granted capability and false otherwise', async () => {
      withProSubscription('active');
      expect(await service.has('user-1', 'reports')).toBe(true);
      expect(await service.has('user-1', 'priority-support')).toBe(false);
    });
  });

  describe('invalidation', () => {
    it('invalidateUser forces a fresh resolve on the next lookup', async () => {
      withProSubscription('active');
      await service.capabilitiesFor('user-1');
      await service.invalidateUser('user-1');
      await service.capabilitiesFor('user-1');
      expect(customers.findOne).toHaveBeenCalledTimes(2);
    });

    it('invalidateAll bumps the version monotonically even within the same millisecond', async () => {
      const now = 1_700_000_000_000;
      const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
      try {
        await service.capabilitiesFor('user-1'); // seeds version = now
        const v0 = cacheStore.get('entitlements:version') as number;

        await service.invalidateAll();
        await service.invalidateAll();
        const v2 = cacheStore.get('entitlements:version') as number;

        // Clock is frozen, so a bare Date.now() would re-emit `now` twice; the
        // max(prev + 1) guard must still advance the version on each bump.
        expect(v0).toBe(now);
        expect(v2).toBe(now + 2);
      } finally {
        spy.mockRestore();
      }
    });

    it('invalidateAll forces a fresh resolve on the next lookup', async () => {
      withProSubscription('active');
      await service.capabilitiesFor('user-1');
      await service.invalidateAll();
      await service.capabilitiesFor('user-1');
      expect(customers.findOne).toHaveBeenCalledTimes(2);
    });
  });
});
