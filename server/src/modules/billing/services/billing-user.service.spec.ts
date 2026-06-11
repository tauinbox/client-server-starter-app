import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import type { BillingProviderId } from '@app/shared/types';
import { User } from '../../users/entities/user.entity';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { PaymentMethod } from '../entities/payment-method.entity';
import { Plan } from '../entities/plan.entity';
import { Product } from '../entities/product.entity';
import { Subscription } from '../entities/subscription.entity';
import {
  InvoicePaidEvent,
  PlanChangedEvent,
  SubscriptionCanceledEvent
} from '../events/billing.events';
import { BillingService } from '../billing.service';
import { ProrationCalculator } from '../rating/proration-calculator';
import { UsageRating } from '../rating/usage-rating.strategy';
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

type InsertedInvoice = Record<string, unknown> & {
  providerEventId?: string | null;
};

/** Transactional manager stub: records invoice inserts, dedups on event id. */
function makeInsertStore() {
  const inserted: InsertedInvoice[] = [];
  let seq = 0;
  const manager = {
    createQueryBuilder: () => {
      const captured: { values?: InsertedInvoice } = {};
      const builder = {
        insert: () => builder,
        into: () => builder,
        values: (v: InsertedInvoice) => {
          captured.values = v;
          return builder;
        },
        orIgnore: () => builder,
        returning: () => builder,
        execute: () => {
          const v = captured.values ?? {};
          const dup = inserted.some(
            (i) => i.providerEventId === v.providerEventId
          );
          if (dup) return Promise.resolve({ raw: [] });
          const id = `inv-${++seq}`;
          inserted.push({ id, ...v });
          return Promise.resolve({ raw: [{ id }] });
        }
      };
      return builder;
    }
  };
  return { inserted, manager };
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
  updatePaymentMethod: jest.Mock;
  cancel: jest.Mock;
  changePlan: jest.Mock;
  previewChangePlan: jest.Mock;
  chargeOffSession: jest.Mock;
  createOneTimePayment: jest.Mock;
  refund: jest.Mock;
} {
  return {
    id,
    managesLifecycle,
    startCheckout: jest
      .fn()
      .mockResolvedValue({ url: 'https://checkout/x', sessionRef: 'sess-1' }),
    createOneTimePayment: jest
      .fn()
      .mockResolvedValue({ url: 'https://pay/x', sessionRef: 'ot-1' }),
    updatePaymentMethod: jest
      .fn()
      .mockResolvedValue({ url: 'https://method/x', sessionRef: 'mu-1' }),
    cancel: jest.fn().mockResolvedValue(undefined),
    changePlan: jest.fn().mockResolvedValue(undefined),
    previewChangePlan: jest
      .fn()
      .mockResolvedValue({ amountMinor: 1700, currency: 'USD' }),
    chargeOffSession: jest
      .fn()
      .mockResolvedValue({ providerInvoiceRef: 'pay_change' }),
    refund: jest.fn().mockResolvedValue(undefined)
  };
}

async function build() {
  const customers = repo();
  const subscriptions = repo();
  const invoices = repo();
  const paymentMethods = repo();
  const plans = repo();
  const products = repo();
  const users = repo();
  const emit = jest.fn();

  const usageRating = { summarizeForPeriod: jest.fn() };

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

  const insertStore = makeInsertStore();
  const dataSource = {
    transaction: (cb: (m: unknown) => unknown) => cb(insertStore.manager)
  };

  const module = await Test.createTestingModule({
    providers: [
      BillingUserService,
      ProrationCalculator,
      { provide: getRepositoryToken(Customer), useValue: customers },
      { provide: getRepositoryToken(Subscription), useValue: subscriptions },
      { provide: getRepositoryToken(Invoice), useValue: invoices },
      { provide: getRepositoryToken(PaymentMethod), useValue: paymentMethods },
      { provide: getRepositoryToken(Plan), useValue: plans },
      { provide: getRepositoryToken(Product), useValue: products },
      { provide: getRepositoryToken(User), useValue: users },
      { provide: getDataSourceToken(), useValue: dataSource },
      { provide: BillingService, useValue: billing },
      { provide: UsageRating, useValue: usageRating },
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
    products,
    users,
    billing,
    usageRating,
    emit,
    insertedInvoices: insertStore.inserted
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    key: 'report-pack',
    name: 'Report pack',
    description: null,
    type: 'sku',
    prices: {
      yookassa: { currency: 'RUB', amountMinor: 49000 },
      paddle: { currency: 'USD', amountMinor: 500, paddlePriceId: 'pri_1' }
    },
    grant: { entitlement: 'reports', durationDays: 30 },
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  } as Product;
}

function makeDonation(overrides: Partial<Product> = {}): Product {
  return makeProduct({
    id: 'prod-don',
    key: 'donation',
    name: 'Donation',
    type: 'custom',
    prices: {
      yookassa: {
        currency: 'RUB',
        minAmountMinor: 10000,
        maxAmountMinor: 5000000
      }
    },
    grant: null,
    ...overrides
  });
}

describe('BillingUserService', () => {
  const RU_CUSTOMER = {
    id: 'cust-1',
    userId: 'user-1',
    country: 'RU',
    currency: 'RUB',
    providerOverride: null
  };

  describe('purchase', () => {
    function setupPurchase(product: Product) {
      return build().then((ctx) => {
        ctx.products.findOne.mockResolvedValue(product);
        ctx.customers.findOne.mockResolvedValue(RU_CUSTOMER);
        const yoo = provider('yookassa', false);
        ctx.billing.resolveProvider.mockResolvedValue(yoo);
        return { ctx, yoo };
      });
    }

    it('charges the catalog price for an sku — a client-sent amount is ignored', async () => {
      const { ctx, yoo } = await setupPurchase(makeProduct());

      const result = await ctx.service.purchase('user-1', {
        productKey: 'report-pack',
        amountMinor: 1
      });

      expect(yoo.createOneTimePayment).toHaveBeenCalledWith(
        RU_CUSTOMER,
        expect.objectContaining({
          amountMinor: 49000,
          currency: 'RUB',
          description: 'Report pack',
          receiptItems: [
            { description: 'Report pack', amountMinor: 49000, quantity: 1 }
          ],
          productId: 'prod-1'
        })
      );
      expect(result).toEqual({
        provider: 'yookassa',
        url: 'https://pay/x',
        sessionRef: 'ot-1'
      });
    });

    it('returns a null url when the provider completes client-side (Paddle.js)', async () => {
      const { ctx, yoo } = await setupPurchase(makeProduct());
      yoo.createOneTimePayment.mockResolvedValue({ sessionRef: 'txn-1' });

      const result = await ctx.service.purchase('user-1', {
        productKey: 'report-pack'
      });

      expect(result).toEqual({
        provider: 'yookassa',
        url: null,
        sessionRef: 'txn-1'
      });
    });

    it('rejects an unknown product with 404', async () => {
      const ctx = await build();
      ctx.products.findOne.mockResolvedValue(null);

      await expect(
        ctx.service.purchase('user-1', { productKey: 'nope' })
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an inactive product with 404', async () => {
      const { ctx } = await setupPurchase(makeProduct({ active: false }));

      await expect(
        ctx.service.purchase('user-1', { productKey: 'report-pack' })
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a product with no price for the resolved provider with 409', async () => {
      const { ctx } = await setupPurchase(
        makeProduct({
          prices: { paddle: { currency: 'USD', amountMinor: 500 } }
        })
      );

      await expect(
        ctx.service.purchase('user-1', { productKey: 'report-pack' })
      ).rejects.toThrow(ConflictException);
    });

    it('rejects an sku whose catalog price is misconfigured with 503', async () => {
      const { ctx } = await setupPurchase(
        makeProduct({ prices: { yookassa: { currency: 'RUB' } } })
      );

      await expect(
        ctx.service.purchase('user-1', { productKey: 'report-pack' })
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('requires an amount for a custom product', async () => {
      const { ctx } = await setupPurchase(makeDonation());

      await expect(
        ctx.service.purchase('user-1', { productKey: 'donation' })
      ).rejects.toThrow(BadRequestException);
    });

    it.each([9999, 5000001])(
      'rejects a custom amount outside the product bounds (%d)',
      async (amountMinor) => {
        const { ctx, yoo } = await setupPurchase(makeDonation());

        await expect(
          ctx.service.purchase('user-1', {
            productKey: 'donation',
            amountMinor
          })
        ).rejects.toThrow(BadRequestException);
        expect(yoo.createOneTimePayment).not.toHaveBeenCalled();
      }
    );

    it('charges a bounded custom amount with the sanitized note on the receipt', async () => {
      const { ctx, yoo } = await setupPurchase(makeDonation());

      await ctx.service.purchase('user-1', {
        productKey: 'donation',
        amountMinor: 150000,
        description: '  Keep\nit  up <3 '
      });

      expect(yoo.createOneTimePayment).toHaveBeenCalledWith(
        RU_CUSTOMER,
        expect.objectContaining({
          amountMinor: 150000,
          description: 'Donation: Keep it up 3',
          receiptItems: [
            {
              description: 'Donation: Keep it up 3',
              amountMinor: 150000,
              quantity: 1
            }
          ]
        })
      );
    });
  });

  describe('listProducts', () => {
    it('lists active fixed-price products carrying a price for the effective provider', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue(RU_CUSTOMER);
      const priced = makeProduct();
      const unpriced = makeProduct({
        id: 'prod-2',
        key: 'paddle-only',
        prices: { paddle: { currency: 'USD', amountMinor: 500 } }
      });
      ctx.products.find.mockResolvedValue([priced, unpriced]);

      const result = await ctx.service.listProducts('user-1');

      expect(result).toEqual([priced]);
      expect(ctx.products.find).toHaveBeenCalledWith({
        where: expect.objectContaining({ active: true }) as unknown,
        order: { createdAt: 'ASC' }
      });
    });

    it('falls back to the geo-default provider for a user without a customer', async () => {
      const ctx = await build();
      ctx.users.findOne.mockResolvedValue({ id: 'user-1', locale: 'en-US' });
      const usdProduct = makeProduct({
        prices: { paddle: { currency: 'USD', amountMinor: 500 } }
      });
      ctx.products.find.mockResolvedValue([usdProduct]);

      const result = await ctx.service.listProducts('user-1');

      expect(result).toEqual([usdProduct]);
      expect(ctx.billing.geoDefaultFor).toHaveBeenCalledWith('US');
    });
  });

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

  describe('startPaymentMethodUpdate', () => {
    it("starts the provider's method-update flow returning to the settings page", async () => {
      const ctx = await build();
      const customer = { id: 'cust-1', userId: 'user-1' };
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue({
        id: 'sub-1',
        provider: 'yookassa' as const,
        providerSubscriptionId: null,
        status: 'active'
      });
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const result = await ctx.service.startPaymentMethodUpdate('user-1');

      expect(ctx.billing.getProviderById).toHaveBeenCalledWith('yookassa');
      expect(yoo.updatePaymentMethod).toHaveBeenCalledWith(null, customer, {
        successUrl: 'http://localhost:4200/billing/settings',
        cancelUrl: 'http://localhost:4200/billing/settings'
      });
      expect(result).toEqual({
        provider: 'yookassa',
        url: 'https://method/x',
        sessionRef: 'mu-1'
      });
    });

    it('passes the provider subscription reference for a provider-managed subscription', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1'
      });
      ctx.subscriptions.findOne.mockResolvedValue({
        id: 'sub-1',
        provider: 'paddle' as const,
        providerSubscriptionId: 'sub_ext',
        status: 'active'
      });
      const paddle = provider('paddle', true);
      ctx.billing.getProviderById.mockReturnValue(paddle);

      await ctx.service.startPaymentMethodUpdate('user-1');

      expect(paddle.updatePaymentMethod).toHaveBeenCalledWith(
        'sub_ext',
        expect.objectContaining({ id: 'cust-1' }),
        expect.anything()
      );
    });

    it('throws when there is no subscription to update the method for', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-1' });
      ctx.subscriptions.findOne.mockResolvedValue(null);

      await expect(
        ctx.service.startPaymentMethodUpdate('user-1')
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a provider-managed subscription not yet linked to the provider', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-1' });
      ctx.subscriptions.findOne.mockResolvedValue({
        id: 'sub-1',
        provider: 'paddle' as const,
        providerSubscriptionId: null,
        status: 'active'
      });
      const paddle = provider('paddle', true);
      ctx.billing.getProviderById.mockReturnValue(paddle);

      await expect(
        ctx.service.startPaymentMethodUpdate('user-1')
      ).rejects.toThrow(ConflictException);
      expect(paddle.updatePaymentMethod).not.toHaveBeenCalled();
    });

    it('throws when the subscription provider is not registered', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-1' });
      ctx.subscriptions.findOne.mockResolvedValue({
        id: 'sub-1',
        provider: 'yookassa' as const,
        providerSubscriptionId: null,
        status: 'active'
      });
      ctx.billing.getProviderById.mockReturnValue(undefined);

      await expect(
        ctx.service.startPaymentMethodUpdate('user-1')
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('changePlan', () => {
    const customer = {
      id: 'cust-1',
      userId: 'user-1',
      country: 'RU',
      currency: 'RUB',
      providerOverride: null
    };
    // 30-day period; the frozen "now" leaves exactly 12 whole days remaining.
    const periodStart = new Date('2026-06-01T00:00:00Z');
    const periodEnd = new Date('2026-07-01T00:00:00Z');
    const frozenNow = new Date('2026-06-19T00:00:00Z');

    const proPlan = makePlan();
    const businessPlan = makePlan({
      id: 'plan-business',
      key: 'business',
      name: 'Business',
      prices: {
        yookassa: { currency: 'RUB', amountMinor: 290000 },
        paddle: {
          currency: 'USD',
          amountMinor: 2900,
          providerPriceId: 'pri_biz'
        }
      }
    });
    const usagePlan = makePlan({
      id: 'plan-usage',
      key: 'usage',
      name: 'Pay as you go',
      billingMode: 'usage',
      meterKey: 'api_calls',
      prices: {
        yookassa: {
          currency: 'RUB',
          amountMinor: 0,
          unitPriceMinor: 200,
          includedUnits: 0
        }
      }
    });

    function makeSub(overrides: Partial<Subscription> = {}): Subscription {
      return {
        id: 'sub-1',
        customerId: 'cust-1',
        planKey: 'pro',
        provider: 'yookassa',
        billingMode: 'fixed',
        status: 'active',
        lifecycleOwner: 'self',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        providerSubscriptionId: null,
        ...overrides
      } as Subscription;
    }

    function plansByKey(ctx: Awaited<ReturnType<typeof build>>): void {
      const byKey: Record<string, Plan> = {
        pro: proPlan,
        business: businessPlan,
        usage: usagePlan
      };
      ctx.plans.findOne.mockImplementation((opts: { where: { key: string } }) =>
        Promise.resolve(byKey[opts.where.key] ?? null)
      );
    }

    beforeEach(() => {
      jest.useFakeTimers({ now: frozenNow, doNotFake: ['nextTick'] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('delegates a provider-managed change to the provider and updates the local row', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue({ ...customer, country: 'US' });
      const sub = makeSub({
        provider: 'paddle',
        lifecycleOwner: 'provider',
        providerSubscriptionId: 'sub_ext'
      });
      ctx.subscriptions.findOne.mockResolvedValue(sub);
      ctx.subscriptions.save.mockImplementation((s: object) =>
        Promise.resolve(s)
      );
      const paddle = provider('paddle', true);
      ctx.billing.getProviderById.mockReturnValue(paddle);

      const result = await ctx.service.changePlan('user-1', 'business');

      expect(paddle.changePlan).toHaveBeenCalledWith(
        'sub_ext',
        expect.objectContaining({ id: 'cust-1' }),
        businessPlan
      );
      expect(paddle.chargeOffSession).not.toHaveBeenCalled();
      expect(paddle.refund).not.toHaveBeenCalled();
      expect(result.planKey).toBe('business');
      expect(ctx.emit).toHaveBeenCalledWith(
        PlanChangedEvent.name,
        expect.objectContaining({
          userId: 'user-1',
          subscriptionId: 'sub-1',
          fromPlanKey: 'pro',
          toPlanKey: 'business'
        })
      );
      expect(ctx.insertedInvoices).toHaveLength(0);
    });

    it('upgrade (self-managed): charges the prorated difference, then refunds the remainder', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.subscriptions.save.mockImplementation((s: object) =>
        Promise.resolve(s)
      );
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: 99000,
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed'
      });
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const result = await ctx.service.changePlan('user-1', 'business');

      // 12 of 30 days: charge 290000*12/30, refund 99000*12/30.
      expect(yoo.chargeOffSession).toHaveBeenCalledWith(
        customer,
        116000,
        expect.arrayContaining([
          expect.objectContaining({ amountMinor: 116000 })
        ]),
        `change-charge:sub-1:business:${periodEnd.getTime()}`
      );
      expect(yoo.refund).toHaveBeenCalledWith(
        'pay_period',
        39600,
        `change-refund:sub-1:business:${periodEnd.getTime()}`
      );
      expect(ctx.insertedInvoices).toHaveLength(2);
      expect(ctx.insertedInvoices[0]).toMatchObject({
        amountMinor: 116000,
        status: 'paid',
        billingMode: 'fixed'
      });
      expect(ctx.insertedInvoices[1]).toMatchObject({
        amountMinor: 39600,
        status: 'refunded'
      });
      expect(result.planKey).toBe('business');
      expect(ctx.emit).toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.objectContaining({ userId: 'user-1' })
      );
      expect(ctx.emit).toHaveBeenCalledWith(
        PlanChangedEvent.name,
        expect.objectContaining({ fromPlanKey: 'pro', toPlanKey: 'business' })
      );
    });

    it('downgrade caps the refund at the original invoice amount', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ planKey: 'business' })
      );
      ctx.subscriptions.save.mockImplementation((s: object) =>
        Promise.resolve(s)
      );
      // The period was paid with a discounted 100000 invoice — smaller than the
      // computed 116000 remainder, so the cap applies.
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: 100000,
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed'
      });
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await ctx.service.changePlan('user-1', 'pro');

      expect(yoo.refund).toHaveBeenCalledWith(
        'pay_period',
        100000,
        expect.any(String)
      );
      expect(yoo.chargeOffSession).toHaveBeenCalledWith(
        customer,
        39600,
        expect.any(Array),
        expect.any(String)
      );
    });

    it('fixed → usage refunds the remainder without charging', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      const sub = makeSub();
      ctx.subscriptions.findOne.mockResolvedValue(sub);
      ctx.subscriptions.save.mockImplementation((s: object) =>
        Promise.resolve(s)
      );
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: 99000,
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed'
      });
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const result = await ctx.service.changePlan('user-1', 'usage');

      expect(yoo.chargeOffSession).not.toHaveBeenCalled();
      expect(yoo.refund).toHaveBeenCalledWith(
        'pay_period',
        39600,
        expect.any(String)
      );
      expect(result.billingMode).toBe('usage');
    });

    it('moves no money on a trial switch', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ status: 'trialing', trialEnd: new Date('2026-06-25') })
      );
      ctx.subscriptions.save.mockImplementation((s: object) =>
        Promise.resolve(s)
      );
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const result = await ctx.service.changePlan('user-1', 'business');

      expect(yoo.chargeOffSession).not.toHaveBeenCalled();
      expect(yoo.refund).not.toHaveBeenCalled();
      expect(ctx.insertedInvoices).toHaveLength(0);
      expect(result.planKey).toBe('business');
    });

    it('a declined charge aborts the switch with nothing moved', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      const yoo = provider('yookassa', false);
      yoo.chargeOffSession.mockRejectedValue(new Error('declined'));
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await expect(
        ctx.service.changePlan('user-1', 'business')
      ).rejects.toThrow('declined');

      expect(yoo.refund).not.toHaveBeenCalled();
      expect(ctx.subscriptions.save).not.toHaveBeenCalled();
      expect(ctx.emit).not.toHaveBeenCalled();
    });

    it('guards: no subscription, same plan, past_due, scheduled cancel, missing provider price', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);

      ctx.subscriptions.findOne.mockResolvedValue(null);
      await expect(ctx.service.changePlan('user-1', 'pro')).rejects.toThrow(
        NotFoundException
      );

      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      await expect(ctx.service.changePlan('user-1', 'pro')).rejects.toThrow(
        'You are already on this plan.'
      );

      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ status: 'past_due' })
      );
      await expect(
        ctx.service.changePlan('user-1', 'business')
      ).rejects.toThrow(ConflictException);

      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ cancelAtPeriodEnd: true })
      );
      await expect(
        ctx.service.changePlan('user-1', 'business')
      ).rejects.toThrow('cancellation is scheduled');

      // The usage plan carries no paddle price → unavailable for a paddle sub.
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ provider: 'paddle', providerSubscriptionId: 'sub_ext' })
      );
      await expect(ctx.service.changePlan('user-1', 'usage')).rejects.toThrow(
        'not available for your billing provider'
      );
    });
  });

  describe('previewChange', () => {
    const customer = {
      id: 'cust-1',
      userId: 'user-1',
      country: 'RU',
      currency: 'RUB',
      providerOverride: null
    };
    const periodEnd = new Date('2026-07-01T00:00:00Z');

    beforeEach(() => {
      jest.useFakeTimers({
        now: new Date('2026-06-19T00:00:00Z'),
        doNotFake: ['nextTick']
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    function setupYoo(ctx: Awaited<ReturnType<typeof build>>) {
      const byKey: Record<string, Plan> = {
        pro: makePlan(),
        business: makePlan({
          id: 'plan-business',
          key: 'business',
          name: 'Business',
          prices: { yookassa: { currency: 'RUB', amountMinor: 290000 } }
        })
      };
      ctx.plans.findOne.mockImplementation((opts: { where: { key: string } }) =>
        Promise.resolve(byKey[opts.where.key] ?? null)
      );
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue({
        id: 'sub-1',
        customerId: 'cust-1',
        planKey: 'pro',
        provider: 'yookassa',
        billingMode: 'fixed',
        status: 'active',
        currentPeriodStart: new Date('2026-06-01T00:00:00Z'),
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false
      });
    }

    it('returns the computed split for a self-managed subscription', async () => {
      const ctx = await build();
      setupYoo(ctx);
      ctx.billing.getProviderById.mockReturnValue(provider('yookassa', false));

      const preview = await ctx.service.previewChange('user-1', 'business');

      expect(preview).toEqual({
        provider: 'yookassa',
        fromPlanKey: 'pro',
        toPlanKey: 'business',
        currency: 'RUB',
        creditMinor: 39600,
        chargeMinor: 116000,
        dueNowMinor: 76400
      });
    });

    it('returns the provider net for a delegated subscription', async () => {
      const ctx = await build();
      const byKey: Record<string, Plan> = {
        pro: makePlan({
          prices: {
            paddle: {
              currency: 'USD',
              amountMinor: 1200,
              providerPriceId: 'pri_pro'
            }
          }
        }),
        business: makePlan({
          id: 'plan-business',
          key: 'business',
          name: 'Business',
          prices: {
            paddle: {
              currency: 'USD',
              amountMinor: 2900,
              providerPriceId: 'pri_biz'
            }
          }
        })
      };
      ctx.plans.findOne.mockImplementation((opts: { where: { key: string } }) =>
        Promise.resolve(byKey[opts.where.key] ?? null)
      );
      ctx.customers.findOne.mockResolvedValue({ ...customer, country: 'US' });
      ctx.subscriptions.findOne.mockResolvedValue({
        id: 'sub-1',
        planKey: 'pro',
        provider: 'paddle',
        status: 'active',
        providerSubscriptionId: 'sub_ext',
        currentPeriodStart: new Date('2026-06-01T00:00:00Z'),
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false
      });
      const paddle = provider('paddle', true);
      ctx.billing.getProviderById.mockReturnValue(paddle);

      const preview = await ctx.service.previewChange('user-1', 'business');

      expect(paddle.previewChangePlan).toHaveBeenCalledWith(
        'sub_ext',
        expect.objectContaining({ key: 'business' })
      );
      expect(preview).toEqual({
        provider: 'paddle',
        fromPlanKey: 'pro',
        toPlanKey: 'business',
        currency: 'USD',
        creditMinor: null,
        chargeMinor: null,
        dueNowMinor: 1700
      });
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

  describe('getUsageSummary', () => {
    const usageSub = {
      id: 'sub-1',
      customerId: 'cust-1',
      planKey: 'usage',
      provider: 'yookassa' as const,
      billingMode: 'usage' as const,
      status: 'active',
      currentPeriodStart: new Date('2026-06-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00Z')
    };

    it('returns null without a customer, subscription, or usage mode', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue(null);
      expect(await ctx.service.getUsageSummary('user-1')).toBeNull();

      ctx.customers.findOne.mockResolvedValue({ id: 'cust-1' });
      ctx.subscriptions.findOne.mockResolvedValue(null);
      expect(await ctx.service.getUsageSummary('user-1')).toBeNull();

      ctx.subscriptions.findOne.mockResolvedValue({
        ...usageSub,
        billingMode: 'fixed'
      });
      expect(await ctx.service.getUsageSummary('user-1')).toBeNull();
      expect(ctx.usageRating.summarizeForPeriod).not.toHaveBeenCalled();
    });

    it('returns null instead of a 500 when the plan row is gone', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-1' });
      ctx.subscriptions.findOne.mockResolvedValue(usageSub);
      ctx.plans.findOne.mockResolvedValue(null);

      expect(await ctx.service.getUsageSummary('user-1')).toBeNull();
    });

    it('rates the current period of the caller’s usage subscription', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-1' });
      ctx.subscriptions.findOne.mockResolvedValue(usageSub);
      const plan = makePlan({
        key: 'usage',
        billingMode: 'usage',
        meterKey: 'api_calls'
      });
      ctx.plans.findOne.mockResolvedValue(plan);
      ctx.usageRating.summarizeForPeriod.mockResolvedValue({
        totalUnits: 142,
        includedUnits: 100,
        billableUnits: 42,
        unitPriceMinor: 200,
        amountMinor: 8400,
        currency: 'RUB',
        receiptItems: [{ description: 'x', amountMinor: 8400, quantity: 1 }]
      });

      const summary = await ctx.service.getUsageSummary('user-1');

      expect(ctx.customers.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-1' }
      });
      expect(ctx.usageRating.summarizeForPeriod).toHaveBeenCalledWith(
        usageSub,
        plan,
        {
          start: usageSub.currentPeriodStart,
          end: usageSub.currentPeriodEnd
        }
      );
      expect(summary).toEqual({
        subscriptionId: 'sub-1',
        meterKey: 'api_calls',
        periodStart: usageSub.currentPeriodStart,
        periodEnd: usageSub.currentPeriodEnd,
        totalUnits: 142,
        includedUnits: 100,
        billableUnits: 42,
        unitPriceMinor: 200,
        amountMinor: 8400,
        currency: 'RUB'
      });
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
