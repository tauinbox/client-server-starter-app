import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { BillingProviderId } from '@app/shared/types';
import { User } from '../../users/entities/user.entity';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { PaymentMethod } from '../entities/payment-method.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { SubscriptionCanceledEvent } from '../events/billing.events';
import { BillingService } from '../billing.service';
import { BillingUserService } from './billing-user.service';

type RepoMock = {
  findOne: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
};

function repo(): RepoMock {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((data: object) => ({ ...data })),
    save: jest.fn((entity: { id?: string }) =>
      Promise.resolve({ id: 'generated-id', ...entity })
    )
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-pro',
    key: 'pro',
    name: 'Pro',
    description: null,
    billingMode: 'fixed',
    interval: 'month',
    meterKey: null,
    entitlements: ['reports'],
    limits: null,
    trialDays: 0,
    active: true,
    prices: { yookassa: { currency: 'RUB', amountMinor: 99000 } },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  } as Plan;
}

function provider(
  id: BillingProviderId,
  managesLifecycle: boolean
): {
  id: BillingProviderId;
  managesLifecycle: boolean;
  startCheckout: jest.Mock;
  cancel: jest.Mock;
} {
  return {
    id,
    managesLifecycle,
    startCheckout: jest
      .fn()
      .mockResolvedValue({ url: 'https://checkout/x', sessionRef: 'sess-1' }),
    cancel: jest.fn().mockResolvedValue(undefined)
  };
}

async function build() {
  const customers = repo();
  const subscriptions = repo();
  const invoices = repo();
  const paymentMethods = repo();
  const plans = repo();
  const users = repo();
  const emit = jest.fn();

  const billing = {
    resolveProvider: jest.fn(),
    getProviderById: jest.fn(),
    geoDefaultFor: jest.fn((country: string) =>
      country.toUpperCase() === 'RU' ? 'yookassa' : 'paddle'
    ),
    effectiveProviderId: jest.fn(
      (c: { providerOverride: BillingProviderId | null; country: string }) =>
        c.providerOverride ??
        (c.country.toUpperCase() === 'RU' ? 'yookassa' : 'paddle')
    )
  };

  const module = await Test.createTestingModule({
    providers: [
      BillingUserService,
      { provide: getRepositoryToken(Customer), useValue: customers },
      { provide: getRepositoryToken(Subscription), useValue: subscriptions },
      { provide: getRepositoryToken(Invoice), useValue: invoices },
      { provide: getRepositoryToken(PaymentMethod), useValue: paymentMethods },
      { provide: getRepositoryToken(Plan), useValue: plans },
      { provide: getRepositoryToken(User), useValue: users },
      { provide: BillingService, useValue: billing },
      {
        provide: ConfigService,
        useValue: { get: () => 'http://localhost:4200' }
      },
      { provide: EventEmitter2, useValue: { emit } }
    ]
  }).compile();

  return {
    service: module.get(BillingUserService),
    customers,
    subscriptions,
    invoices,
    paymentMethods,
    plans,
    users,
    billing,
    emit
  };
}

describe('BillingUserService', () => {
  describe('checkout', () => {
    it('creates a local incomplete subscription for a self-managed provider', async () => {
      const ctx = await build();
      ctx.plans.findOne.mockResolvedValue(makePlan());
      ctx.customers.save.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'RU',
        providerOverride: null
      });
      ctx.users.findOne.mockResolvedValue({ id: 'user-1', locale: 'ru' });
      const yoo = provider('yookassa', false);
      ctx.billing.resolveProvider.mockResolvedValue(yoo);

      const result = await ctx.service.checkout('user-1', 'pro');

      expect(ctx.subscriptions.save).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-1',
          planKey: 'pro',
          provider: 'yookassa',
          status: 'incomplete',
          lifecycleOwner: 'self'
        })
      );
      expect(result).toEqual({
        provider: 'yookassa',
        url: 'https://checkout/x',
        sessionRef: 'sess-1'
      });
    });

    it('does not create a local subscription for a provider-managed provider', async () => {
      const ctx = await build();
      ctx.plans.findOne.mockResolvedValue(makePlan());
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'US',
        providerOverride: null
      });
      ctx.billing.resolveProvider.mockResolvedValue(provider('paddle', true));

      await ctx.service.checkout('user-1', 'pro');

      expect(ctx.subscriptions.save).not.toHaveBeenCalled();
    });

    it('rejects checkout when the plan is unknown', async () => {
      const ctx = await build();
      ctx.plans.findOne.mockResolvedValue(null);

      await expect(ctx.service.checkout('user-1', 'ghost')).rejects.toThrow(
        NotFoundException
      );
    });

    it('rejects checkout when an active subscription already exists', async () => {
      const ctx = await build();
      ctx.plans.findOne.mockResolvedValue(makePlan());
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'US',
        providerOverride: null
      });
      ctx.subscriptions.findOne.mockResolvedValue({ id: 'sub-1' });

      await expect(ctx.service.checkout('user-1', 'pro')).rejects.toThrow(
        ConflictException
      );
      expect(ctx.billing.resolveProvider).not.toHaveBeenCalled();
    });
  });

  describe('cancelSubscription', () => {
    it('flags cancel-at-period-end by default and asks the provider to cancel', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-1' });
      const sub = {
        id: 'sub-1',
        provider: 'paddle' as const,
        providerSubscriptionId: 'sub_ext',
        status: 'active',
        cancelAtPeriodEnd: false
      };
      ctx.subscriptions.findOne.mockResolvedValue(sub);
      ctx.subscriptions.save.mockImplementation((s: object) =>
        Promise.resolve(s)
      );
      const paddle = provider('paddle', true);
      ctx.billing.getProviderById.mockReturnValue(paddle);

      const result = await ctx.service.cancelSubscription('user-1');

      expect(paddle.cancel).toHaveBeenCalledWith('sub_ext', 'period_end');
      expect(result.cancelAtPeriodEnd).toBe(true);
      expect(result.status).toBe('active');
      expect(ctx.emit).not.toHaveBeenCalled();
    });

    it('cancels immediately and emits SubscriptionCanceled', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-1' });
      ctx.subscriptions.findOne.mockResolvedValue({
        id: 'sub-1',
        provider: 'yookassa' as const,
        providerSubscriptionId: null,
        status: 'active',
        cancelAtPeriodEnd: false
      });
      ctx.subscriptions.save.mockImplementation((s: object) =>
        Promise.resolve(s)
      );

      const result = await ctx.service.cancelSubscription(
        'user-1',
        'immediate'
      );

      expect(result.status).toBe('canceled');
      expect(ctx.emit).toHaveBeenCalledWith(
        SubscriptionCanceledEvent.name,
        expect.objectContaining({ userId: 'user-1', subscriptionId: 'sub-1' })
      );
    });

    it('throws when there is no subscription to cancel', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-1' });
      ctx.subscriptions.findOne.mockResolvedValue(null);

      await expect(ctx.service.cancelSubscription('user-1')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('reads scope to the caller', () => {
    it('returns null subscription and empty invoices when the user has no customer', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue(null);

      expect(await ctx.service.getCurrentSubscription('user-1')).toBeNull();
      expect(await ctx.service.listInvoices('user-1')).toEqual([]);
      expect(await ctx.service.getDefaultPaymentMethod('user-1')).toBeNull();
    });

    it('queries invoices keyed by the resolved customer id', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-9' });
      ctx.invoices.find.mockResolvedValue([]);

      await ctx.service.listInvoices('user-1');

      expect(ctx.invoices.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { customerId: 'cust-9' } })
      );
    });
  });

  describe('region', () => {
    it('reports the geo default derived from locale when no customer exists', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue(null);
      ctx.users.findOne.mockResolvedValue({ id: 'user-1', locale: 'ru' });

      const region = await ctx.service.getRegion('user-1');

      expect(region).toEqual({
        region: 'auto',
        detectedProvider: 'yookassa',
        effectiveProvider: 'yookassa'
      });
    });

    it('persists the override when no conflicting subscription exists', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'US',
        providerOverride: null
      });
      ctx.subscriptions.findOne.mockResolvedValue(null);
      ctx.customers.save.mockImplementation((c: object) => Promise.resolve(c));

      const region = await ctx.service.setRegion('user-1', 'ru');

      expect(ctx.customers.save).toHaveBeenCalledWith(
        expect.objectContaining({ providerOverride: 'yookassa' })
      );
      expect(region.region).toBe('ru');
      expect(region.effectiveProvider).toBe('yookassa');
    });

    it('rejects a region change that would orphan a live subscription on another provider', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'US',
        providerOverride: null
      });
      ctx.subscriptions.findOne.mockResolvedValue({
        id: 'sub-1',
        provider: 'paddle'
      });

      await expect(ctx.service.setRegion('user-1', 'ru')).rejects.toThrow(
        ConflictException
      );
      expect(ctx.customers.save).not.toHaveBeenCalled();
    });
  });
});
