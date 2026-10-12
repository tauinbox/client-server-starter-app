import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import type { BillingProviderId } from '@app/shared/types';
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
import { SubscriptionCanceledEvent } from '../events/billing.events';
import { RenewalService } from '../renewals/renewal.service';
import { BillingService } from '../billing.service';
import { UsageRating } from '../rating/usage-rating.strategy';
import {
  expectRefusal,
  makePlan,
  provider,
  repo
} from '../testing/billing-service.fixtures';
import { BillingUserService } from './billing-user.service';
import { CreditService } from './credit.service';

function cursorQuery(overrides: Partial<InvoiceCursorQueryDto> = {}) {
  return Object.assign(new InvoiceCursorQueryDto(), overrides);
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

  const module = await Test.createTestingModule({
    providers: [
      BillingUserService,
      { provide: getRepositoryToken(Customer), useValue: customers },
      { provide: getRepositoryToken(Subscription), useValue: subscriptions },
      { provide: getRepositoryToken(Invoice), useValue: invoices },
      { provide: getRepositoryToken(PaymentMethod), useValue: paymentMethods },
      { provide: getRepositoryToken(Plan), useValue: plans },
      { provide: getRepositoryToken(Product), useValue: products },
      { provide: getRepositoryToken(User), useValue: users },
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
    emit
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
        },
        false
      );
    });

    it('gives a trial when the plan has one and the customer never used one', async () => {
      const ctx = await build();
      ctx.plans.findOne.mockResolvedValue(makePlan({ trialDays: 14 }));
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'RU',
        providerOverride: null,
        trialUsedAt: null
      });
      const yoo = provider('yookassa', false);
      ctx.billing.resolveProvider.mockResolvedValue(yoo);

      await ctx.service.checkout('user-1', 'pro');

      expect(ctx.subscriptions.save).toHaveBeenCalledWith(
        expect.objectContaining({ trialEnd: expect.any(Date) as Date })
      );
      expect(yoo.startCheckout).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        true
      );
    });

    it('gives no second trial to a customer who used one', async () => {
      const ctx = await build();
      ctx.plans.findOne.mockResolvedValue(makePlan({ trialDays: 14 }));
      ctx.customers.findOne.mockResolvedValue({
        id: 'cust-1',
        userId: 'user-1',
        country: 'RU',
        providerOverride: null,
        trialUsedAt: new Date('2026-09-01T00:00:00Z')
      });
      const yoo = provider('yookassa', false);
      ctx.billing.resolveProvider.mockResolvedValue(yoo);

      await ctx.service.checkout('user-1', 'pro');

      expect(ctx.subscriptions.save).toHaveBeenCalledWith(
        expect.objectContaining({ trialEnd: null })
      );
      expect(yoo.startCheckout).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        false
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
