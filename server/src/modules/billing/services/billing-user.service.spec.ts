import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import type { HttpException, Type } from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { In, Not } from 'typeorm';
import type { FindOperator } from 'typeorm';
import type { BillingProviderId } from '@app/shared/types';
import { Money } from '@app/shared/utils/money';
import {
  DEFAULT_CURSOR_PAGE_SIZE,
  ErrorKeys,
  OPEN_SUBSCRIPTION_STATUSES
} from '@app/shared/constants';
import { InvoiceCursorQueryDto } from '../dtos/billing-cursor-query.dto';
import { encodeCursor } from '../../../common/utils/cursor.util';
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
  SubscriptionCanceledEvent,
  UsagePeriodClosedEvent
} from '../events/billing.events';
import { RenewalService } from '../renewals/renewal.service';
import { BillingService } from '../billing.service';

import { ProrationCalculator } from '../rating/proration-calculator';
import { UsageRating } from '../rating/usage-rating.strategy';
import { ChargeDeclinedError } from '../providers/payment-provider.interface';
import { ProviderTimeoutError } from '../providers/provider-deadline';
import { BillingUserService } from './billing-user.service';
import { CreditService } from './credit.service';

/** A refusal answers its status class and the key that the client translates. */
async function expectRefusal(
  action: Promise<unknown>,
  type: Type<HttpException>,
  errorKey: string
): Promise<void> {
  const error: unknown = await action.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(type);
  expect(error).toMatchObject({ response: { errorKey } });
}

type QueryBuilderMock = {
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  take: jest.Mock;
  getMany: jest.Mock;
};

type RepoMock = {
  findOne: jest.Mock;
  find: jest.Mock;
  createQueryBuilder: jest.Mock;
  qb: QueryBuilderMock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
};

/** Chainable query-builder stub; `getMany` is what each test drives. */
function queryBuilder(): QueryBuilderMock {
  const qb: Partial<QueryBuilderMock> = {};
  qb.where = jest.fn().mockReturnValue(qb);
  qb.andWhere = jest.fn().mockReturnValue(qb);
  qb.orderBy = jest.fn().mockReturnValue(qb);
  qb.addOrderBy = jest.fn().mockReturnValue(qb);
  qb.take = jest.fn().mockReturnValue(qb);
  qb.getMany = jest.fn().mockResolvedValue([]);
  return qb as QueryBuilderMock;
}

function repo(): RepoMock {
  const qb = queryBuilder();
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    qb,
    create: jest.fn((data: object) => ({ ...data })),
    save: jest.fn((entity: { id?: string }) =>
      Promise.resolve({ id: 'generated-id', ...entity })
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 })
  };
}

function cursorQuery(overrides: Partial<InvoiceCursorQueryDto> = {}) {
  return Object.assign(new InvoiceCursorQueryDto(), overrides);
}

type InsertedInvoice = Record<string, unknown> & {
  providerEventId?: string | null;
  status?: string;
};

type InvoiceCriteria = {
  id?: string;
  providerEventId?: string;
  status?: string | FindOperator<string>;
};

/** Matches a stored row's status against a plain value or an `In([...])`. */
function statusMatches(
  row: InsertedInvoice,
  expected: InvoiceCriteria['status']
): boolean {
  if (expected === undefined) return true;
  if (typeof expected === 'string') return row.status === expected;
  const allowed: string[] = Array.isArray(expected.value)
    ? expected.value
    : [expected.value];
  return allowed.includes(row.status ?? '');
}

/**
 * Transactional manager stub: records invoice inserts, dedups on event id, and
 * applies invoice updates to the stored rows so a plant-then-settle sequence is
 * observable as the row's final state (the charge leg is now recorded before
 * the provider call and settled afterwards, not inserted once at the end).
 */
function makeInsertStore(invoices: RepoMock) {
  const inserted: InsertedInvoice[] = [];
  let seq = 0;
  const applyInvoiceUpdate = (
    criteria: InvoiceCriteria,
    patch: Record<string, unknown>
  ): { affected: number } => {
    const matched = inserted.filter(
      (row) =>
        (criteria.id === undefined || row['id'] === criteria.id) &&
        (criteria.providerEventId === undefined ||
          row.providerEventId === criteria.providerEventId) &&
        statusMatches(row, criteria.status)
    );
    for (const row of matched) {
      Object.assign(row, patch);
    }
    return { affected: matched.length };
  };
  invoices.update = jest.fn(
    (criteria: InvoiceCriteria, patch: Record<string, unknown>) =>
      Promise.resolve(applyInvoiceUpdate(criteria, patch))
  );
  const manager = {
    // changePlan applies the plan and bumps the refund source within the tx.
    save: (_target: unknown, entity: { id?: string }) =>
      Promise.resolve({ id: 'generated-id', ...entity }),
    update: jest.fn(
      (
        target: unknown,
        criteria: InvoiceCriteria,
        patch: Record<string, unknown>
      ) =>
        Promise.resolve(
          target === Invoice
            ? applyInvoiceUpdate(criteria, patch)
            : { affected: 1 }
        )
    ),
    // The proration refund reserves its leg on the source invoice under a row
    // lock, so that read goes through the transactional manager.
    findOne: jest.fn((entity: unknown, options: unknown): Promise<unknown> =>
      entity === Invoice
        ? (invoices.findOne(options) as Promise<unknown>)
        : Promise.resolve(null)
    ),
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
  /**
   * A thrown callback rolls the transaction back, so the stub has to undo the
   * rows it recorded inside it - without this a probe for "what survives a
   * crash mid-transaction" would see writes a real database discards.
   */
  const snapshot = (): InsertedInvoice[] => inserted.map((row) => ({ ...row }));
  const restore = (rows: InsertedInvoice[]): void => {
    inserted.splice(0, inserted.length, ...rows);
  };
  return { inserted, manager, snapshot, restore };
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
  };
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
    chargeOffSession: jest.fn().mockResolvedValue({
      providerInvoiceRef: 'pay_change',
      status: 'captured'
    }),
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
  const credits = { getBalance: jest.fn().mockResolvedValue(null) };
  const renewals = { billClosingUsagePeriod: jest.fn() };

  const billing = {
    resolveProvider: jest.fn(),
    isProviderAvailable: jest.fn().mockResolvedValue(true),
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

  const insertStore = makeInsertStore(invoices);
  const dataSource = {
    manager: insertStore.manager,
    transaction: jest.fn(async (cb: (m: unknown) => unknown) => {
      const before = insertStore.snapshot();
      try {
        return await cb(insertStore.manager);
      } catch (error) {
        insertStore.restore(before);
        throw error;
      }
    })
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
      { provide: RenewalService, useValue: renewals },
      { provide: CreditService, useValue: credits },
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
    renewals,
    credits,
    usageRating,
    emit,
    dataSource,
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
  };
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

      await expectRefusal(
        ctx.service.purchase('user-1', { productKey: 'nope' }),
        NotFoundException,
        ErrorKeys.BILLING.PRODUCT_NOT_FOUND
      );
    });

    it('rejects an inactive product with 404', async () => {
      const { ctx } = await setupPurchase(makeProduct({ active: false }));

      await expectRefusal(
        ctx.service.purchase('user-1', { productKey: 'report-pack' }),
        NotFoundException,
        ErrorKeys.BILLING.PRODUCT_NOT_FOUND
      );
    });

    it('rejects a product with no price for the resolved provider with 409', async () => {
      const { ctx } = await setupPurchase(
        makeProduct({
          prices: { paddle: { currency: 'USD', amountMinor: 500 } }
        })
      );

      await expectRefusal(
        ctx.service.purchase('user-1', { productKey: 'report-pack' }),
        ConflictException,
        ErrorKeys.BILLING.PRODUCT_UNAVAILABLE_FOR_PROVIDER
      );
    });

    it('rejects an sku whose catalog price is misconfigured with 503', async () => {
      const { ctx } = await setupPurchase(
        makeProduct({ prices: { yookassa: { currency: 'RUB' } } })
      );

      await expectRefusal(
        ctx.service.purchase('user-1', { productKey: 'report-pack' }),
        ServiceUnavailableException,
        ErrorKeys.BILLING.PRODUCT_NOT_CONFIGURED
      );
    });

    describe('on Paddle', () => {
      function setupPaddle(product: Product) {
        return build().then((ctx) => {
          ctx.products.findOne.mockResolvedValue(product);
          ctx.customers.findOne.mockResolvedValue(RU_CUSTOMER);
          const paddle = provider('paddle', true);
          ctx.billing.resolveProvider.mockResolvedValue(paddle);
          return { ctx, paddle };
        });
      }

      it.each(['sku', 'credits'] as const)(
        'rejects a %s product with no Paddle catalog price with 503',
        async (type) => {
          const { ctx, paddle } = await setupPaddle(
            makeProduct({
              type,
              prices: { paddle: { currency: 'USD', amountMinor: 500 } }
            })
          );

          await expectRefusal(
            ctx.service.purchase('user-1', { productKey: 'report-pack' }),
            ServiceUnavailableException,
            ErrorKeys.BILLING.PRODUCT_NOT_CONFIGURED
          );
          expect(paddle.createOneTimePayment).not.toHaveBeenCalled();
        }
      );

      it('opens a custom-amount purchase with no catalog price', async () => {
        const { ctx, paddle } = await setupPaddle(
          makeDonation({
            prices: {
              paddle: {
                currency: 'USD',
                minAmountMinor: 100,
                maxAmountMinor: 50000
              }
            }
          })
        );

        await ctx.service.purchase('user-1', {
          productKey: 'donation',
          amountMinor: 1500
        });

        expect(paddle.createOneTimePayment).toHaveBeenCalledWith(
          RU_CUSTOMER,
          expect.objectContaining({
            amountMinor: 1500,
            paddlePriceId: undefined
          })
        );
      });
    });

    it('requires an amount for a custom product', async () => {
      const { ctx } = await setupPurchase(makeDonation());

      await expectRefusal(
        ctx.service.purchase('user-1', { productKey: 'donation' }),
        BadRequestException,
        ErrorKeys.BILLING.AMOUNT_REQUIRED
      );
    });

    it.each([9999, 5000001])(
      'rejects a custom amount outside the product bounds (%d)',
      async (amountMinor) => {
        const { ctx, yoo } = await setupPurchase(makeDonation());

        await expectRefusal(
          ctx.service.purchase('user-1', {
            productKey: 'donation',
            amountMinor
          }),
          BadRequestException,
          ErrorKeys.BILLING.AMOUNT_OUT_OF_RANGE
        );
        expect(yoo.createOneTimePayment).not.toHaveBeenCalled();
      }
    );

    it('treats a zero lower bound as configured, not as missing bounds', async () => {
      // `!minAmountMinor` rejected a legitimate 0 lower bound as unconfigured
      // and answered 503 for every donation to such a product.
      const { ctx, yoo } = await setupPurchase(
        makeDonation({
          prices: {
            yookassa: {
              currency: 'RUB',
              minAmountMinor: 0,
              maxAmountMinor: 5000000
            }
          }
        })
      );

      await ctx.service.purchase('user-1', {
        productKey: 'donation',
        amountMinor: 500
      });

      expect(yoo.createOneTimePayment).toHaveBeenCalledWith(
        RU_CUSTOMER,
        expect.objectContaining({ amountMinor: 500 })
      );
    });

    it('still rejects a custom product with no bounds configured with 503', async () => {
      const { ctx } = await setupPurchase(
        makeDonation({ prices: { yookassa: { currency: 'RUB' } } })
      );

      await expectRefusal(
        ctx.service.purchase('user-1', {
          productKey: 'donation',
          amountMinor: 500
        }),
        ServiceUnavailableException,
        ErrorKeys.BILLING.PRODUCT_NOT_CONFIGURED
      );
    });

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
    it('lists active products carrying a price entry for the effective provider, including custom bounds', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue(RU_CUSTOMER);
      const priced = makeProduct();
      const donation = makeDonation();
      const unpriced = makeProduct({
        id: 'prod-2',
        key: 'paddle-only',
        prices: { paddle: { currency: 'USD', amountMinor: 500 } }
      });
      ctx.products.find.mockResolvedValue([priced, donation, unpriced]);

      const result = await ctx.service.listProducts('user-1');

      expect(result).toEqual([priced, donation]);
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

  describe('getCredits', () => {
    it('returns null for a user with no billing customer', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue(null);

      await expect(ctx.service.getCredits('user-1')).resolves.toBeNull();
      expect(ctx.credits.getBalance).not.toHaveBeenCalled();
    });

    it("returns the customer's balance", async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue(RU_CUSTOMER);
      const balance = {
        customerId: RU_CUSTOMER.id,
        balanceUnits: 1240,
        updatedAt: new Date()
      };
      ctx.credits.getBalance.mockResolvedValue(balance);

      await expect(ctx.service.getCredits('user-1')).resolves.toBe(balance);
      expect(ctx.credits.getBalance).toHaveBeenCalledWith(RU_CUSTOMER.id);
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

    it('returns to the client checkout-return routes (/billing/success|cancel)', async () => {
      const ctx = await build();
      ctx.plans.findOne.mockResolvedValue(makePlan());
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'US',
        providerOverride: null
      });
      const paddle = provider('paddle', true);
      ctx.billing.resolveProvider.mockResolvedValue(paddle);

      await ctx.service.checkout('user-1', 'pro');

      expect(paddle.startCheckout).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        {
          successUrl: 'http://localhost:4200/billing/success',
          cancelUrl: 'http://localhost:4200/billing/cancel'
        }
      );
    });

    it('rejects checkout when the plan is unknown', async () => {
      const ctx = await build();
      ctx.plans.findOne.mockResolvedValue(null);

      await expectRefusal(
        ctx.service.checkout('user-1', 'ghost'),
        NotFoundException,
        ErrorKeys.BILLING.PLAN_NOT_FOUND
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

      await expectRefusal(
        ctx.service.checkout('user-1', 'pro'),
        ConflictException,
        ErrorKeys.BILLING.ALREADY_SUBSCRIBED
      );
      expect(ctx.billing.resolveProvider).not.toHaveBeenCalled();
    });

    it('reuses an existing incomplete row on a repeat self-managed checkout', async () => {
      const ctx = await build();
      ctx.plans.findOne.mockResolvedValue(makePlan());
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'RU',
        providerOverride: null
      });
      ctx.billing.resolveProvider.mockResolvedValue(
        provider('yookassa', false)
      );
      // active check: none; pending check: a prior unpaid row.
      ctx.subscriptions.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'sub-pending', status: 'incomplete' });

      await ctx.service.checkout('user-1', 'pro');

      expect(ctx.subscriptions.create).not.toHaveBeenCalled();
      expect(ctx.subscriptions.save).not.toHaveBeenCalled();
      expect(ctx.subscriptions.update).toHaveBeenCalledWith(
        { id: 'sub-pending', status: 'incomplete' },
        expect.objectContaining({ planKey: 'pro', status: 'incomplete' })
      );
    });

    it('returns 409 without rewriting the row when the incomplete row was activated mid-checkout', async () => {
      const ctx = await build();
      ctx.plans.findOne.mockResolvedValue(makePlan());
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'RU',
        providerOverride: null
      });
      ctx.billing.resolveProvider.mockResolvedValue(
        provider('yookassa', false)
      );
      ctx.subscriptions.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'sub-pending', status: 'incomplete' });
      // The first-payment webhook flipped the row to `active` in the meantime,
      // so the conditional write matches nothing.
      ctx.subscriptions.update.mockResolvedValue({ affected: 0 });

      await expectRefusal(
        ctx.service.checkout('user-1', 'pro'),
        ConflictException,
        ErrorKeys.BILLING.ALREADY_SUBSCRIBED
      );
      expect(ctx.subscriptions.save).not.toHaveBeenCalled();
    });

    it('returns 409 when a concurrent checkout wins the insert race', async () => {
      const ctx = await build();
      ctx.plans.findOne.mockResolvedValue(makePlan());
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'RU',
        providerOverride: null
      });
      ctx.billing.resolveProvider.mockResolvedValue(
        provider('yookassa', false)
      );
      ctx.subscriptions.findOne.mockResolvedValue(null);
      ctx.subscriptions.save.mockRejectedValueOnce({ code: '23505' });

      await expectRefusal(
        ctx.service.checkout('user-1', 'pro'),
        ConflictException,
        ErrorKeys.BILLING.ALREADY_SUBSCRIBED
      );
    });

    it('releases a stale self incomplete row when the provider is provider-managed', async () => {
      const ctx = await build();
      ctx.plans.findOne.mockResolvedValue(makePlan());
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'US',
        providerOverride: null
      });
      ctx.billing.resolveProvider.mockResolvedValue(provider('paddle', true));
      ctx.subscriptions.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'sub-pending', status: 'incomplete' });

      await ctx.service.checkout('user-1', 'pro');

      expect(ctx.subscriptions.save).not.toHaveBeenCalled();
      expect(ctx.subscriptions.update).toHaveBeenCalledWith(
        { id: 'sub-pending', status: 'incomplete' },
        { status: 'canceled' }
      );
    });

    it('returns 409 rather than canceling a self row that was activated mid-checkout', async () => {
      const ctx = await build();
      ctx.plans.findOne.mockResolvedValue(makePlan());
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'US',
        providerOverride: null
      });
      const paddle = provider('paddle', true);
      ctx.billing.resolveProvider.mockResolvedValue(paddle);
      ctx.subscriptions.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'sub-pending', status: 'incomplete' });
      ctx.subscriptions.update.mockResolvedValue({ affected: 0 });

      await expectRefusal(
        ctx.service.checkout('user-1', 'pro'),
        ConflictException,
        ErrorKeys.BILLING.ALREADY_SUBSCRIBED
      );
      expect(paddle.startCheckout).not.toHaveBeenCalled();
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
      const paddle = provider('paddle', true);
      ctx.billing.getProviderById.mockReturnValue(paddle);

      const result = await ctx.service.cancelSubscription('user-1');

      expect(paddle.cancel).toHaveBeenCalledWith('sub_ext', 'period_end');
      expect(result.cancelAtPeriodEnd).toBe(true);
      expect(result.status).toBe('active');
      expect(ctx.emit).not.toHaveBeenCalled();
      // Only the cancel column is written — the row moved on while the provider
      // was cancelling, and the whole entity would carry it back.
      expect(ctx.subscriptions.save).not.toHaveBeenCalled();
      expect(ctx.subscriptions.update).toHaveBeenCalledWith(
        { id: 'sub-1', status: In([...OPEN_SUBSCRIPTION_STATUSES]) },
        { cancelAtPeriodEnd: true }
      );
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

      const result = await ctx.service.cancelSubscription(
        'user-1',
        'immediate'
      );

      expect(result.status).toBe('canceled');
      expect(ctx.subscriptions.save).not.toHaveBeenCalled();
      expect(ctx.subscriptions.update).toHaveBeenCalledWith(
        { id: 'sub-1', status: In([...OPEN_SUBSCRIPTION_STATUSES]) },
        { status: 'canceled', cancelAtPeriodEnd: false }
      );
      expect(ctx.emit).toHaveBeenCalledWith(
        SubscriptionCanceledEvent.name,
        expect.objectContaining({ userId: 'user-1', subscriptionId: 'sub-1' })
      );
    });

    it('bills the closing metered period before an immediate cancel', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-1' });
      const sub = {
        id: 'sub-1',
        provider: 'yookassa' as const,
        providerSubscriptionId: null,
        status: 'active',
        cancelAtPeriodEnd: false
      };
      ctx.subscriptions.findOne.mockResolvedValue(sub);

      await ctx.service.cancelSubscription('user-1', 'immediate');

      expect(ctx.renewals.billClosingUsagePeriod).toHaveBeenCalledWith(
        sub,
        expect.any(Date),
        true
      );
    });

    it('leaves a period-end cancel to the renewal scan at the boundary', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-1' });
      ctx.subscriptions.findOne.mockResolvedValue({
        id: 'sub-1',
        provider: 'yookassa' as const,
        providerSubscriptionId: null,
        status: 'active',
        cancelAtPeriodEnd: false
      });

      await ctx.service.cancelSubscription('user-1');

      expect(ctx.renewals.billClosingUsagePeriod).not.toHaveBeenCalled();
    });

    it('answers 409 and emits nothing when a concurrent writer cancelled first', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-1' });
      ctx.subscriptions.findOne.mockResolvedValue({
        id: 'sub-1',
        provider: 'yookassa' as const,
        providerSubscriptionId: null,
        status: 'active',
        cancelAtPeriodEnd: false
      });
      ctx.subscriptions.update.mockResolvedValue({ affected: 0 });

      await expectRefusal(
        ctx.service.cancelSubscription('user-1', 'immediate'),
        ConflictException,
        ErrorKeys.BILLING.SUBSCRIPTION_ALREADY_CANCELED
      );
      expect(ctx.emit).not.toHaveBeenCalled();
    });

    it('throws when there is no subscription to cancel', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-1' });
      ctx.subscriptions.findOne.mockResolvedValue(null);

      await expectRefusal(
        ctx.service.cancelSubscription('user-1'),
        NotFoundException,
        ErrorKeys.BILLING.NO_ACTIVE_SUBSCRIPTION
      );
    });
  });

  describe('startPaymentMethodUpdate', () => {
    it("starts the provider's method-update flow returning to the settings page", async () => {
      const ctx = await build();
      // A locale currency unlike the RUB price: the re-bind takes the price's.
      const customer = { id: 'cust-1', userId: 'user-1', currency: 'USD' };
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue({
        id: 'sub-1',
        planKey: 'pro',
        provider: 'yookassa' as const,
        providerSubscriptionId: null,
        status: 'active'
      });
      ctx.plans.findOne.mockResolvedValue(makePlan());
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const result = await ctx.service.startPaymentMethodUpdate('user-1');

      expect(ctx.billing.getProviderById).toHaveBeenCalledWith('yookassa');
      expect(ctx.plans.findOne).toHaveBeenCalledWith({
        where: { key: 'pro' }
      });
      expect(yoo.updatePaymentMethod).toHaveBeenCalledWith(
        null,
        customer,
        'RUB',
        {
          successUrl: 'http://localhost:4200/billing/settings',
          cancelUrl: 'http://localhost:4200/billing/settings'
        }
      );
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
        planKey: 'pro',
        provider: 'paddle' as const,
        providerSubscriptionId: 'sub_ext',
        status: 'active'
      });
      ctx.plans.findOne.mockResolvedValue(
        makePlan({ prices: { paddle: { currency: 'USD', amountMinor: 1200 } } })
      );
      const paddle = provider('paddle', true);
      ctx.billing.getProviderById.mockReturnValue(paddle);

      await ctx.service.startPaymentMethodUpdate('user-1');

      expect(paddle.updatePaymentMethod).toHaveBeenCalledWith(
        'sub_ext',
        expect.objectContaining({ id: 'cust-1' }),
        'USD',
        expect.anything()
      );
    });

    it('refuses the re-bind when the plan of the subscription has no price for its provider', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1'
      });
      ctx.subscriptions.findOne.mockResolvedValue({
        id: 'sub-1',
        planKey: 'gone',
        provider: 'yookassa' as const,
        providerSubscriptionId: null,
        status: 'active'
      });
      ctx.plans.findOne.mockResolvedValue(null);
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await expectRefusal(
        ctx.service.startPaymentMethodUpdate('user-1'),
        ServiceUnavailableException,
        ErrorKeys.BILLING.CURRENT_PLAN_MISSING
      );
      expect(yoo.updatePaymentMethod).not.toHaveBeenCalled();
    });

    it('throws when there is no subscription to update the method for', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-1' });
      ctx.subscriptions.findOne.mockResolvedValue(null);

      await expectRefusal(
        ctx.service.startPaymentMethodUpdate('user-1'),
        NotFoundException,
        ErrorKeys.BILLING.NO_ACTIVE_SUBSCRIPTION
      );
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

      await expectRefusal(
        ctx.service.startPaymentMethodUpdate('user-1'),
        ConflictException,
        ErrorKeys.BILLING.SUBSCRIPTION_NOT_LINKED
      );
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
      ctx.billing.getProviderById.mockImplementation(() => {
        throw new ServiceUnavailableException({
          errorKey: ErrorKeys.BILLING.PROVIDER_UNAVAILABLE
        });
      });

      await expectRefusal(
        ctx.service.startPaymentMethodUpdate('user-1'),
        ServiceUnavailableException,
        ErrorKeys.BILLING.PROVIDER_UNAVAILABLE
      );
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
        version: 1,
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

    it.each([
      [
        'a period past its end',
        { currentPeriodEnd: new Date('2026-06-18T00:00:00Z') }
      ],
      [
        'a trial past its end',
        {
          status: 'trialing' as const,
          trialEnd: new Date('2026-06-19T00:00:00Z')
        }
      ]
    ])(
      'refuses a self-managed change on %s, before any money moves',
      async (_case, overrides) => {
        const ctx = await build();
        plansByKey(ctx);
        ctx.customers.findOne.mockResolvedValue(customer);
        ctx.subscriptions.findOne.mockResolvedValue(
          makeSub({ planKey: 'usage', billingMode: 'usage', ...overrides })
        );
        const yoo = provider('yookassa', false);
        ctx.billing.getProviderById.mockReturnValue(yoo);
        const message =
          'The billing period has ended and its renewal is in progress. Try again shortly.';

        await expect(ctx.service.changePlan('user-1', 'pro')).rejects.toThrow(
          new ConflictException(message)
        );
        await expect(
          ctx.service.previewChange('user-1', 'pro')
        ).rejects.toThrow(new ConflictException(message));
        await expectRefusal(
          ctx.service.changePlan('user-1', 'pro'),
          ConflictException,
          ErrorKeys.BILLING.RENEWAL_IN_PROGRESS
        );

        expect(ctx.subscriptions.update).not.toHaveBeenCalled();
        expect(ctx.renewals.billClosingUsagePeriod).not.toHaveBeenCalled();
        expect(yoo.chargeOffSession).not.toHaveBeenCalled();
      }
    );

    it('lets a provider-managed row change after its local period end', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue({ ...customer, country: 'US' });
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({
          provider: 'paddle',
          lifecycleOwner: 'provider',
          providerSubscriptionId: 'sub_ext',
          currentPeriodEnd: new Date('2026-06-18T00:00:00Z')
        })
      );
      const paddle = provider('paddle', true);
      ctx.billing.getProviderById.mockReturnValue(paddle);

      const result = await ctx.service.changePlan('user-1', 'business');

      expect(result.planKey).toBe('business');
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
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: Money.fromMinor(99000),
        refundedMinor: Money.fromMinor(0),
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
        'RUB',
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
        amountMinor: Money.fromMinor(116000),
        status: 'paid',
        billingMode: 'fixed'
      });
      expect(ctx.insertedInvoices[1]).toMatchObject({
        amountMinor: Money.fromMinor(39600),
        status: 'refunded'
      });
      // A partial refund leaves the source paid, so the admin can refund the rest.
      expect(ctx.dataSource.manager.update).not.toHaveBeenCalledWith(
        Invoice,
        expect.objectContaining({ id: 'inv-period' }),
        expect.anything()
      );
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

    it('records an uncaptured proration charge as pending and defers InvoicePaid to the webhook', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      const yoo = provider('yookassa', false);
      yoo.chargeOffSession.mockResolvedValue({
        providerInvoiceRef: 'pay_change',
        status: 'pending'
      });
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const result = await ctx.service.changePlan('user-1', 'business');

      // Funds are not captured yet: the invoice must not read as paid, and the
      // paid event must wait for the confirming webhook.
      expect(ctx.insertedInvoices[0]).toMatchObject({
        amountMinor: Money.fromMinor(116000),
        status: 'pending',
        paidAt: null
      });
      expect(
        ctx.emit.mock.calls.filter(
          (call: unknown[]) => call[0] === InvoicePaidEvent.name
        )
      ).toHaveLength(0);
      // The switch itself still applies.
      expect(result.planKey).toBe('business');
      expect(ctx.emit).toHaveBeenCalledWith(
        PlanChangedEvent.name,
        expect.objectContaining({ toPlanKey: 'business' })
      );
    });

    it('downgrade caps the refund at the original invoice amount', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ planKey: 'business' })
      );
      // The period was paid with a discounted 100000 invoice — smaller than the
      // computed 116000 remainder, so the cap applies.
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: Money.fromMinor(100000),
        refundedMinor: Money.fromMinor(0),
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
      // Refunded in full: the source leaves `paid`, so no admin refund is offered.
      expect(ctx.dataSource.manager.update).toHaveBeenCalledWith(
        Invoice,
        { id: 'inv-period', status: 'paid' },
        { status: 'refunded' }
      );
      expect(yoo.chargeOffSession).toHaveBeenCalledWith(
        customer,
        39600,
        'RUB',
        expect.any(Array),
        expect.any(String)
      );
    });

    it('charges and records both legs in the currency of the price, not the locale currency of the customer', async () => {
      const ctx = await build();
      plansByKey(ctx);
      // A non-Russian locale that chose the region "Russia": USD on the
      // customer row, RUB on every YooKassa price.
      ctx.customers.findOne.mockResolvedValue({
        ...customer,
        country: 'US',
        currency: 'USD',
        providerOverride: 'yookassa'
      });
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: Money.fromMinor(99000),
        refundedMinor: Money.fromMinor(0),
        currency: 'RUB',
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed'
      });
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await ctx.service.changePlan('user-1', 'business');

      expect(yoo.chargeOffSession).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'USD' }),
        116000,
        'RUB',
        expect.any(Array),
        expect.any(String)
      );
      expect(ctx.insertedInvoices).toHaveLength(2);
      expect(ctx.insertedInvoices[0]).toMatchObject({
        status: 'paid',
        currency: 'RUB'
      });
      expect(ctx.insertedInvoices[1]).toMatchObject({
        status: 'refunded',
        currency: 'RUB'
      });
    });

    it('previews a trial switch in the currency of the target price', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue({
        ...customer,
        currency: 'USD'
      });
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ status: 'trialing' })
      );
      ctx.billing.getProviderById.mockReturnValue(provider('yookassa', false));

      const preview = await ctx.service.previewChange('user-1', 'business');

      expect(preview).toMatchObject({ currency: 'RUB', dueNowMinor: 0 });
    });

    it('fixed → usage refunds the remainder without charging', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      const sub = makeSub();
      ctx.subscriptions.findOne.mockResolvedValue(sub);
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: Money.fromMinor(99000),
        refundedMinor: Money.fromMinor(0),
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

    it('fixed → usage starts the metered window at the switch and bills nothing for it', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.billing.getProviderById.mockReturnValue(provider('yookassa', false));

      const result = await ctx.service.changePlan('user-1', 'usage');

      expect(ctx.dataSource.manager.update).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({ id: 'sub-1' }),
        { planKey: 'usage', billingMode: 'usage', meteredFrom: frozenNow }
      );
      expect(result.meteredFrom).toEqual(frozenNow);
      expect(ctx.renewals.billClosingUsagePeriod).not.toHaveBeenCalled();
    });

    it('usage → fixed bills the closing window under the outgoing plan, then moves it', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ planKey: 'usage', billingMode: 'usage' })
      );
      const planAtClose: string[] = [];
      ctx.renewals.billClosingUsagePeriod.mockImplementation(
        (sub: Subscription) => {
          planAtClose.push(sub.planKey);
          return Promise.resolve();
        }
      );
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const result = await ctx.service.changePlan('user-1', 'pro');

      expect(ctx.renewals.billClosingUsagePeriod).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub-1' }),
        frozenNow
      );
      expect(planAtClose).toEqual(['usage']);
      expect(ctx.subscriptions.update).toHaveBeenCalledWith(
        { id: 'sub-1' },
        { meteredFrom: frozenNow }
      );
      expect(result).toMatchObject({ planKey: 'pro', billingMode: 'fixed' });
    });

    it('usage → fixed bills nothing when the prorated charge is declined', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ planKey: 'usage', billingMode: 'usage' })
      );
      const yoo = provider('yookassa', false);
      yoo.chargeOffSession.mockRejectedValue(new Error('declined'));
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await expect(ctx.service.changePlan('user-1', 'pro')).rejects.toThrow(
        'declined'
      );

      expect(ctx.renewals.billClosingUsagePeriod).not.toHaveBeenCalled();
    });

    it('usage → fixed on a provider-managed row closes the window with the outgoing plan', async () => {
      const ctx = await build();
      const paddleUsage = makePlan({
        ...usagePlan,
        prices: {
          paddle: {
            currency: 'USD',
            amountMinor: 0,
            unitPriceMinor: 2,
            providerPriceId: 'pri_usage'
          }
        }
      });
      ctx.plans.findOne.mockImplementation((opts: { where: { key: string } }) =>
        Promise.resolve(
          opts.where.key === 'usage'
            ? paddleUsage
            : opts.where.key === 'business'
              ? businessPlan
              : null
        )
      );
      ctx.customers.findOne.mockResolvedValue({ ...customer, country: 'US' });
      const switchedIn = new Date('2026-06-05T00:00:00Z');
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({
          planKey: 'usage',
          billingMode: 'usage',
          provider: 'paddle',
          lifecycleOwner: 'provider',
          providerSubscriptionId: 'sub_ext',
          meteredFrom: switchedIn
        })
      );
      ctx.billing.getProviderById.mockReturnValue(provider('paddle', true));

      await ctx.service.changePlan('user-1', 'business');

      expect(ctx.emit).toHaveBeenCalledWith(
        UsagePeriodClosedEvent.name,
        expect.objectContaining({
          userId: 'user-1',
          subscriptionId: 'sub-1',
          periodStart: switchedIn,
          periodEnd: frozenNow,
          planKey: 'usage'
        })
      );
      expect(ctx.dataSource.manager.update).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({ id: 'sub-1' }),
        { planKey: 'business', billingMode: 'fixed', meteredFrom: frozenNow }
      );
    });

    it('a switch that keeps the billing mode leaves the metered window alone', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue({ ...customer, country: 'US' });
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({
          provider: 'paddle',
          lifecycleOwner: 'provider',
          providerSubscriptionId: 'sub_ext'
        })
      );
      ctx.billing.getProviderById.mockReturnValue(provider('paddle', true));

      await ctx.service.changePlan('user-1', 'business');

      expect(ctx.dataSource.manager.update).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({ id: 'sub-1' }),
        { planKey: 'business', billingMode: 'fixed' }
      );
      expect(ctx.emit).not.toHaveBeenCalledWith(
        UsagePeriodClosedEvent.name,
        expect.anything()
      );
    });

    it('moves no money on a trial switch', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ status: 'trialing', trialEnd: new Date('2026-06-25') })
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
      await expectRefusal(
        ctx.service.changePlan('user-1', 'pro'),
        NotFoundException,
        ErrorKeys.BILLING.NO_ACTIVE_SUBSCRIPTION
      );

      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      await expectRefusal(
        ctx.service.changePlan('user-1', 'pro'),
        ConflictException,
        ErrorKeys.BILLING.SAME_PLAN
      );

      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ status: 'past_due' })
      );
      await expectRefusal(
        ctx.service.changePlan('user-1', 'business'),
        ConflictException,
        ErrorKeys.BILLING.SUBSCRIPTION_NOT_CHANGEABLE
      );

      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ cancelAtPeriodEnd: true })
      );
      await expectRefusal(
        ctx.service.changePlan('user-1', 'business'),
        ConflictException,
        ErrorKeys.BILLING.CANCELLATION_SCHEDULED
      );

      // The usage plan carries no paddle price → unavailable for a paddle sub.
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ provider: 'paddle', providerSubscriptionId: 'sub_ext' })
      );
      await expectRefusal(
        ctx.service.changePlan('user-1', 'usage'),
        ConflictException,
        ErrorKeys.BILLING.PLAN_UNAVAILABLE_FOR_PROVIDER
      );
    });

    it('serializes concurrent changes: the claim CAS loser is rejected with no second charge', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: Money.fromMinor(99000),
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed',
        refundedMinor: Money.fromMinor(0)
      });
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);
      // First claim wins the compare-and-swap; the second misses (affected 0).
      ctx.subscriptions.update
        .mockResolvedValueOnce({ affected: 1 })
        .mockResolvedValueOnce({ affected: 0 });

      const results = await Promise.allSettled([
        ctx.service.changePlan('user-1', 'business'),
        ctx.service.changePlan('user-1', 'business')
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(rejected[0].reason).toMatchObject({
        response: { errorKey: ErrorKeys.BILLING.SUBSCRIPTION_BUSY }
      });
      // The loser never reaches the provider, so the customer is charged once.
      expect(yoo.chargeOffSession).toHaveBeenCalledTimes(1);
    });

    it('commits the charge invoice and the plan apply in one transaction — a commit failure announces nothing', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);
      // The single local transaction fails after the provider charge succeeded.
      ctx.dataSource.transaction.mockImplementation(() => {
        throw new Error('db write failed');
      });

      await expect(
        ctx.service.changePlan('user-1', 'business')
      ).rejects.toThrow('db write failed');

      // The charge happened (idempotent for a later retry) but nothing local was
      // committed, so no PlanChanged / InvoicePaid escapes as "applied".
      expect(yoo.chargeOffSession).toHaveBeenCalledTimes(1);
      expect(ctx.emit).not.toHaveBeenCalled();
    });

    it('excludes its own charge leg from the refund source so it cannot refund itself', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);
      let sourceWhere: Record<string, unknown> | undefined;
      ctx.invoices.findOne.mockImplementation(
        (options: { where: Record<string, unknown> }) => {
          sourceWhere = options.where;
          return Promise.resolve({
            id: 'inv-period',
            amountMinor: Money.fromMinor(99000),
            providerInvoiceRef: 'pay_period',
            status: 'paid',
            billingMode: 'fixed',
            refundedMinor: Money.fromMinor(0)
          });
        }
      );

      await ctx.service.changePlan('user-1', 'business');

      // The charge leg is on the books before the source is picked, so the
      // lookup must exclude it by id - a webhook settling it first would
      // otherwise make this switch refund the payment it just took.
      expect(ctx.insertedInvoices[0]['id']).toBe('inv-1');
      expect(sourceWhere).toMatchObject({ id: Not('inv-1') });
      expect(yoo.refund).toHaveBeenCalledWith(
        'pay_period',
        39600,
        expect.any(String)
      );
    });

    it('records the charge before asking the provider for the money', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      const yoo = provider('yookassa', false);
      let recordedWhenCharged: InsertedInvoice | undefined;
      yoo.chargeOffSession.mockImplementation(() => {
        recordedWhenCharged = { ...ctx.insertedInvoices[0] };
        return Promise.resolve({
          providerInvoiceRef: 'pay_change',
          status: 'captured'
        });
      });
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await ctx.service.changePlan('user-1', 'business');

      expect(recordedWhenCharged).toMatchObject({
        providerEventId: `change-charge:sub-1:business:${periodEnd.getTime()}`,
        amountMinor: Money.fromMinor(116000),
        status: 'pending',
        paidAt: null
      });
    });

    it('leaves the captured charge on the books when the closing transaction dies', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);
      const applyUpdate =
        ctx.dataSource.manager.update.getMockImplementation() as (
          target: unknown,
          criteria: unknown,
          patch: unknown
        ) => Promise<{ affected: number }>;
      // The request dies after the capture: a pool timeout, the provider
      // deadline unwinding the handler, a restart.
      ctx.dataSource.manager.update.mockImplementation(
        (target: unknown, criteria: unknown, patch: unknown) =>
          target === Subscription
            ? Promise.reject(new Error('connection terminated'))
            : applyUpdate(target, criteria, patch)
      );

      await expect(
        ctx.service.changePlan('user-1', 'business')
      ).rejects.toThrow('connection terminated');

      // Without the pre-charge plant this leaves nothing at all: a real
      // payment with no invoice, no ledger row and no log line.
      expect(ctx.insertedInvoices).toHaveLength(1);
      expect(ctx.insertedInvoices[0]).toMatchObject({
        providerEventId: `change-charge:sub-1:business:${periodEnd.getTime()}`,
        providerInvoiceRef: 'pay_change',
        amountMinor: Money.fromMinor(116000)
      });
    });

    it('marks the planted row failed when the provider declines the card', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      const yoo = provider('yookassa', false);
      yoo.chargeOffSession.mockRejectedValue(
        new ChargeDeclinedError('card declined')
      );
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await expect(
        ctx.service.changePlan('user-1', 'business')
      ).rejects.toBeInstanceOf(ChargeDeclinedError);

      // A decline is the one charge failure whose outcome is known, so the
      // row reads failed rather than lingering as money the customer owes.
      expect(ctx.insertedInvoices[0]).toMatchObject({ status: 'failed' });
      expect(yoo.refund).not.toHaveBeenCalled();
      expect(ctx.emit).not.toHaveBeenCalled();
    });

    it('leaves the planted row pending when the charge outcome is unknown', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      const yoo = provider('yookassa', false);
      yoo.chargeOffSession.mockRejectedValue(
        new ProviderTimeoutError('yookassa', 'chargeOffSession', 20000)
      );
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await expect(
        ctx.service.changePlan('user-1', 'business')
      ).rejects.toBeInstanceOf(ProviderTimeoutError);

      // The deadline bounds our call, not the provider's request: the payment
      // may still capture, and the confirming webhook settles this row.
      expect(ctx.insertedInvoices[0]).toMatchObject({ status: 'pending' });
    });

    it('applies the switch as a two-column guarded write, never as a whole-entity save', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      ctx.billing.getProviderById.mockReturnValue(provider('yookassa', false));

      await ctx.service.changePlan('user-1', 'business');

      // Nothing the concurrent writer owns (status, period, dunning, cancel
      // flag) may appear in the write set, and the guard carries the claimed
      // version, mode and period so a row that moved during the charge loses.
      expect(ctx.dataSource.manager.update).toHaveBeenCalledWith(
        Subscription,
        {
          id: 'sub-1',
          version: 2,
          billingMode: 'fixed',
          status: In(['trialing', 'active']),
          cancelAtPeriodEnd: false,
          currentPeriodEnd: periodEnd
        },
        { planKey: 'business', billingMode: 'fixed' }
      );
    });

    it('refuses the switch but keeps the money recorded when the row moved during the charge', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue(null);
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);
      // A cancel (or any guarded column change) landed while the charge was in
      // flight, so the apply finds no row matching the claim. Only the
      // subscription write misses - the invoice legs still settle.
      const applyUpdate =
        ctx.dataSource.manager.update.getMockImplementation() as (
          target: unknown,
          criteria: unknown,
          patch: unknown
        ) => Promise<{ affected: number }>;
      ctx.dataSource.manager.update.mockImplementation(
        (target: unknown, criteria: unknown, patch: unknown) =>
          target === Subscription
            ? Promise.resolve({ affected: 0 })
            : applyUpdate(target, criteria, patch)
      );

      await expectRefusal(
        ctx.service.changePlan('user-1', 'business'),
        ConflictException,
        ErrorKeys.BILLING.PLAN_CHANGE_PAYMENT_CONFLICT
      );

      expect(yoo.chargeOffSession).toHaveBeenCalledTimes(1);
      // The charge left the customer's card, so its invoice must survive the
      // refused switch — nothing else would ever record it.
      expect(ctx.insertedInvoices).toHaveLength(1);
      expect(ctx.insertedInvoices[0]).toMatchObject({ status: 'paid' });
      expect(
        ctx.emit.mock.calls.filter(
          (call: unknown[]) => call[0] === PlanChangedEvent.name
        )
      ).toHaveLength(0);
      expect(ctx.emit).toHaveBeenCalledWith(
        InvoicePaidEvent.name,
        expect.objectContaining({ userId: 'user-1' })
      );
    });

    it('rejects a provider-managed change whose local row moved during the provider call', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue({ ...customer, country: 'US' });
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({
          provider: 'paddle',
          lifecycleOwner: 'provider',
          providerSubscriptionId: 'sub_ext'
        })
      );
      ctx.billing.getProviderById.mockReturnValue(provider('paddle', true));
      ctx.dataSource.manager.update.mockResolvedValue({ affected: 0 });

      await expectRefusal(
        ctx.service.changePlan('user-1', 'business'),
        ConflictException,
        ErrorKeys.BILLING.PLAN_CHANGE_CONFLICT
      );

      expect(ctx.subscriptions.save).not.toHaveBeenCalled();
      expect(ctx.emit).not.toHaveBeenCalled();
    });

    it('caps the proration refund by the source’s already-refunded amount', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(makeSub());
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: Money.fromMinor(99000),
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed',
        refundedMinor: Money.fromMinor(80000)
      });
      const yoo = provider('yookassa', false);
      ctx.billing.getProviderById.mockReturnValue(yoo);

      await ctx.service.changePlan('user-1', 'business');

      // refundable = 99000 - 80000 = 19000; the 39600 remainder is capped to it.
      expect(yoo.refund).toHaveBeenCalledWith(
        'pay_period',
        19000,
        expect.any(String)
      );
      // The earlier legs and this one add up to the whole invoice.
      expect(ctx.dataSource.manager.update).toHaveBeenCalledWith(
        Invoice,
        { id: 'inv-period', status: 'paid' },
        { status: 'refunded' }
      );
    });

    it('keeps the source paid when the full proration refund fails at the provider', async () => {
      const ctx = await build();
      plansByKey(ctx);
      ctx.customers.findOne.mockResolvedValue(customer);
      ctx.subscriptions.findOne.mockResolvedValue(
        makeSub({ planKey: 'business' })
      );
      ctx.invoices.findOne.mockResolvedValue({
        id: 'inv-period',
        amountMinor: Money.fromMinor(100000),
        refundedMinor: Money.fromMinor(0),
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed'
      });
      const yoo = provider('yookassa', false);
      yoo.refund.mockRejectedValue(new Error('provider down'));
      ctx.billing.getProviderById.mockReturnValue(yoo);

      const result = await ctx.service.changePlan('user-1', 'pro');

      expect(result.planKey).toBe('pro');
      expect(ctx.dataSource.manager.update).not.toHaveBeenCalledWith(
        Invoice,
        expect.objectContaining({ id: 'inv-period' }),
        expect.anything()
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

    function periodInvoice(refundedMinor: number) {
      return {
        id: 'inv-period',
        amountMinor: Money.fromMinor(99000),
        refundedMinor: Money.fromMinor(refundedMinor),
        providerInvoiceRef: 'pay_period',
        status: 'paid',
        billingMode: 'fixed'
      };
    }

    it('returns the computed split for a self-managed subscription', async () => {
      const ctx = await build();
      setupYoo(ctx);
      ctx.invoices.findOne.mockResolvedValue(periodInvoice(0));
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
      expect(ctx.invoices.findOne).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-1',
          status: 'paid',
          billingMode: 'fixed'
        },
        order: { createdAt: 'DESC' }
      });
    });

    it('caps the credit by what is still refundable on the source invoice', async () => {
      const ctx = await build();
      setupYoo(ctx);
      ctx.invoices.findOne.mockResolvedValue(periodInvoice(80000));
      ctx.billing.getProviderById.mockReturnValue(provider('yookassa', false));

      const preview = await ctx.service.previewChange('user-1', 'business');

      // refundable = 99000 - 80000 = 19000, the same cap changePlan applies.
      expect(preview).toMatchObject({
        creditMinor: 19000,
        chargeMinor: 116000,
        dueNowMinor: 97000
      });
    });

    it('shows no credit when no paid fixed invoice covers the period', async () => {
      const ctx = await build();
      setupYoo(ctx);
      ctx.billing.getProviderById.mockReturnValue(provider('yookassa', false));

      const preview = await ctx.service.previewChange('user-1', 'business');

      expect(preview).toMatchObject({
        creditMinor: 0,
        chargeMinor: 116000,
        dueNowMinor: 116000
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
    it('returns null subscription and an empty page when the user has no customer', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue(null);

      expect(await ctx.service.getCurrentSubscription('user-1')).toBeNull();
      const invoices = await ctx.service.listInvoices('user-1', cursorQuery());
      expect(invoices.data).toEqual([]);
      expect(invoices.meta).toEqual({
        nextCursor: null,
        hasMore: false,
        limit: DEFAULT_CURSOR_PAGE_SIZE
      });
      // No customer means no invoice query is issued at all.
      expect(ctx.invoices.createQueryBuilder).not.toHaveBeenCalled();
      expect(await ctx.service.getDefaultPaymentMethod('user-1')).toBeNull();
    });

    it('scopes the invoice page to the resolved customer id', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-9' });

      await ctx.service.listInvoices('user-1', cursorQuery());

      expect(ctx.invoices.qb.where).toHaveBeenCalledWith(
        'invoice.customerId = :customerId',
        { customerId: 'cust-9' }
      );
      expect(ctx.invoices.qb.orderBy).toHaveBeenCalledWith(
        'invoice.createdAt',
        'DESC'
      );
      expect(ctx.invoices.qb.take).toHaveBeenCalledWith(
        DEFAULT_CURSOR_PAGE_SIZE + 1
      );
    });

    it('mints a cursor only while another page exists', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-9' });
      ctx.invoices.qb.getMany.mockResolvedValue([
        { id: 'inv-1', createdAt: new Date('2026-06-02T00:00:00Z') },
        { id: 'inv-2', createdAt: new Date('2026-06-01T00:00:00Z') }
      ]);

      const page = await ctx.service.listInvoices(
        'user-1',
        cursorQuery({ limit: 1 })
      );

      expect(page.data).toHaveLength(1);
      expect(page.meta.hasMore).toBe(true);
      expect(page.meta.nextCursor).toEqual(expect.any(String));

      ctx.invoices.qb.getMany.mockResolvedValue([
        { id: 'inv-2', createdAt: new Date('2026-06-01T00:00:00Z') }
      ]);
      const last = await ctx.service.listInvoices(
        'user-1',
        cursorQuery({ limit: 1 })
      );
      expect(last.meta.hasMore).toBe(false);
      expect(last.meta.nextCursor).toBeNull();
    });

    it('carries the caller scope into the cursor page too', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-9' });
      const cursor = encodeCursor({
        sortValue: '2026-06-01T00:00:00.000Z',
        id: 'inv-5'
      });

      await ctx.service.listInvoices('user-1', cursorQuery({ cursor }));

      // Scope first, keyset second - a follow-up page must not widen to
      // another customer's invoices.
      expect(ctx.invoices.qb.where).toHaveBeenCalledWith(
        'invoice.customerId = :customerId',
        { customerId: 'cust-9' }
      );
      expect(ctx.invoices.qb.andWhere).toHaveBeenCalledWith(
        '(invoice.createdAt, invoice.id) < (:cursorSortValue, :cursorId)',
        { cursorSortValue: '2026-06-01T00:00:00.000Z', cursorId: 'inv-5' }
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

    it('rates and reports only the window a switch to the usage plan opened', async () => {
      const ctx = await build();
      const switchedAt = new Date('2026-06-11T00:00:00Z');
      const sub = { ...usageSub, meteredFrom: switchedAt };
      ctx.customers.findOne.mockResolvedValue({ id: 'cust-1' });
      ctx.subscriptions.findOne.mockResolvedValue(sub);
      const plan = makePlan({ key: 'usage', billingMode: 'usage' });
      ctx.plans.findOne.mockResolvedValue(plan);
      ctx.usageRating.summarizeForPeriod.mockResolvedValue({
        totalUnits: 0,
        includedUnits: 0,
        billableUnits: 0,
        unitPriceMinor: 200,
        amountMinor: 0,
        currency: 'RUB',
        receiptItems: []
      });

      const summary = await ctx.service.getUsageSummary('user-1');

      expect(ctx.usageRating.summarizeForPeriod).toHaveBeenCalledWith(
        sub,
        plan,
        { start: switchedAt, end: usageSub.currentPeriodEnd }
      );
      expect(summary?.periodStart).toBe(switchedAt);
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
        effectiveProvider: 'yookassa',
        availableProviders: ['paddle', 'yookassa']
      });
    });

    it('lists only the providers that a checkout can use now', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'US',
        providerOverride: null
      });
      ctx.billing.isProviderAvailable.mockImplementation(
        (id: BillingProviderId) => Promise.resolve(id === 'paddle')
      );

      const region = await ctx.service.getRegion('user-1');

      expect(region.availableProviders).toEqual(['paddle']);
    });

    it('persists the override when no conflicting subscription exists', async () => {
      const ctx = await build();
      const stored = {
        id: 'cust-1',
        userId: 'user-1',
        country: 'US',
        providerOverride: null
      };
      ctx.customers.findOne
        .mockResolvedValueOnce(stored)
        .mockResolvedValueOnce({ ...stored, providerOverride: 'yookassa' });
      ctx.subscriptions.findOne.mockResolvedValue(null);

      const region = await ctx.service.setRegion('user-1', 'ru');

      expect(ctx.customers.update).toHaveBeenCalledWith(
        { id: 'cust-1' },
        { providerOverride: 'yookassa' }
      );
      expect(ctx.customers.save).not.toHaveBeenCalled();
      expect(region.region).toBe('ru');
      expect(region.effectiveProvider).toBe('yookassa');
      expect(region.availableProviders).toEqual(['paddle', 'yookassa']);
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

      await expectRefusal(
        ctx.service.setRegion('user-1', 'ru'),
        ConflictException,
        ErrorKeys.BILLING.REGION_CHANGE_BLOCKED
      );
      expect(ctx.customers.update).not.toHaveBeenCalled();
      expect(ctx.customers.save).not.toHaveBeenCalled();
    });

    it('rejects a region whose provider is unavailable before the subscription guard', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'RU',
        providerOverride: null
      });
      ctx.billing.isProviderAvailable.mockImplementation(
        (id: BillingProviderId) => Promise.resolve(id === 'yookassa')
      );

      const refusal = ctx.service.setRegion('user-1', 'world');

      await expect(refusal).rejects.toThrow(ConflictException);
      await expect(refusal).rejects.toMatchObject({
        response: { errorKey: ErrorKeys.BILLING.REGION_UNAVAILABLE }
      });
      expect(ctx.billing.isProviderAvailable).toHaveBeenCalledWith(
        'paddle',
        'user-1'
      );
      expect(ctx.subscriptions.findOne).not.toHaveBeenCalled();
      expect(ctx.customers.update).not.toHaveBeenCalled();
    });

    it('checks the geo default provider when the region is auto', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'RU',
        providerOverride: 'paddle'
      });
      ctx.billing.isProviderAvailable.mockResolvedValue(false);

      await expect(ctx.service.setRegion('user-1', 'auto')).rejects.toThrow(
        ConflictException
      );
      expect(ctx.billing.isProviderAvailable).toHaveBeenCalledWith(
        'yookassa',
        'user-1'
      );
      expect(ctx.customers.update).not.toHaveBeenCalled();
    });

    it('returns the winner when concurrent first requests race customer creation (23505)', async () => {
      const ctx = await build();
      const winner = {
        id: 'cust-1',
        userId: 'user-1',
        country: 'RU',
        providerOverride: null
      };
      // First lookup: no customer yet -> proceed to insert. Insert hits the
      // unique constraint on user_id, so the post-violation lookup returns
      // the concurrent winner.
      ctx.customers.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winner)
        .mockResolvedValueOnce({ ...winner, providerOverride: 'yookassa' });
      ctx.users.findOne.mockResolvedValue({ id: 'user-1', locale: 'ru' });
      ctx.customers.save.mockRejectedValueOnce({ code: '23505' });
      ctx.subscriptions.findOne.mockResolvedValue(null);

      const region = await ctx.service.setRegion('user-1', 'ru');

      expect(region.region).toBe('ru');
      expect(ctx.customers.update).toHaveBeenCalledWith(
        { id: 'cust-1' },
        { providerOverride: 'yookassa' }
      );
    });

    it('recognises the unique violation when TypeORM wraps the driver error', async () => {
      const ctx = await build();
      const winner = {
        id: 'cust-1',
        userId: 'user-1',
        country: 'RU',
        providerOverride: null
      };
      ctx.customers.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winner);
      ctx.users.findOne.mockResolvedValue({ id: 'user-1', locale: 'ru' });
      ctx.customers.save.mockRejectedValueOnce({
        driverError: { code: '23505' }
      });
      ctx.subscriptions.findOne.mockResolvedValue(null);

      await expect(
        ctx.service.setRegion('user-1', 'ru')
      ).resolves.toMatchObject({ region: 'ru' });
    });

    it('answers 404 when the user of the first billing action is gone', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue(null);
      ctx.users.findOne.mockResolvedValue(null);

      await expectRefusal(
        ctx.service.setRegion('user-1', 'ru'),
        NotFoundException,
        ErrorKeys.USERS.NOT_FOUND
      );
      expect(ctx.customers.save).not.toHaveBeenCalled();
    });

    it('rethrows non-unique-violation errors from customer creation', async () => {
      const ctx = await build();
      ctx.customers.findOne.mockResolvedValue(null);
      ctx.users.findOne.mockResolvedValue({ id: 'user-1', locale: 'ru' });
      ctx.customers.save.mockRejectedValue(new Error('connection lost'));

      await expect(ctx.service.setRegion('user-1', 'ru')).rejects.toThrow(
        'connection lost'
      );
    });
  });
});
