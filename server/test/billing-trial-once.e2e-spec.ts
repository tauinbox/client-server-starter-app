// A customer gets one trial. These cases run checkout, the first-payment
// webhook and an immediate cancel against a real PostgreSQL, then check out
// again: the second checkout must charge the full price.

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';
import { User } from '../src/modules/users/entities/user.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { PaymentMethod } from '../src/modules/billing/entities/payment-method.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Product } from '../src/modules/billing/entities/product.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { BillingService } from '../src/modules/billing/billing.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { UsageRating } from '../src/modules/billing/rating/usage-rating.strategy';
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { BillingUserService } from '../src/modules/billing/services/billing-user.service';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import {
  BILLING_DB_LOCK_TIMEOUT_MS,
  holdBillingDbLock
} from './billing-db-lock';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const PLAN = 'trial-once-pro';

runWithInfra('One trial for each customer (e2e)', () => {
  let ds: DataSource;
  let releaseDbLock: (() => Promise<void>) | undefined;
  let service: BillingUserService;
  let reducer: BillingEventReducer;
  let startCheckout: jest.Mock;
  let userId: string | undefined;
  let customerId: string | undefined;

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
    releaseDbLock = await holdBillingDbLock(ds);
    await ds.getRepository(Plan).save(
      ds.getRepository(Plan).create({
        key: PLAN,
        name: PLAN,
        description: null,
        billingMode: 'fixed',
        interval: 'month',
        meterKey: null,
        entitlements: [],
        limits: null,
        trialDays: 14,
        active: true,
        prices: { yookassa: { currency: 'RUB', amountMinor: 99000 } }
      })
    );
  }, BILLING_DB_LOCK_TIMEOUT_MS);

  beforeEach(async () => {
    startCheckout = jest
      .fn()
      .mockResolvedValue({ url: 'https://checkout/x', sessionRef: 'sess-1' });
    const provider = {
      id: 'yookassa',
      managesLifecycle: false,
      startCheckout,
      cancel: jest.fn().mockResolvedValue(undefined),
      refund: jest.fn().mockResolvedValue(undefined)
    };
    const module = await Test.createTestingModule({
      providers: [
        BillingUserService,
        BillingEventReducer,
        { provide: getDataSourceToken(), useValue: ds },
        ...[
          Customer,
          Subscription,
          Invoice,
          PaymentMethod,
          Plan,
          Product,
          User
        ].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: ds.getRepository(entity)
        })),
        {
          provide: BillingService,
          useValue: {
            getProviderById: () => provider,
            resolveProvider: () => Promise.resolve(provider)
          }
        },
        {
          provide: CreditService,
          useValue: {
            getBalance: () => Promise.resolve(null),
            releaseHolds: () => Promise.resolve()
          }
        },
        { provide: UsageRating, useValue: { summarizeForPeriod: jest.fn() } },
        {
          provide: RenewalService,
          useValue: { billClosingUsagePeriod: jest.fn() }
        },
        {
          provide: MetricsService,
          useValue: { recordUnmatchedOffSessionCharge: jest.fn() }
        },
        {
          provide: ConfigService,
          useValue: { get: () => 'http://localhost:4200' }
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } }
      ]
    }).compile();
    service = module.get(BillingUserService);
    reducer = module.get(BillingEventReducer);

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `trial-once-${stamp}@example.com`,
        name: 'Trial Once',
        password: 'hashed'
      })
    );
    userId = user.id;
    const customer = await ds.getRepository(Customer).save(
      ds.getRepository(Customer).create({
        userId: user.id,
        provider: 'yookassa',
        providerOverride: null,
        providerCustomerId: null,
        country: 'RU',
        currency: 'RUB',
        defaultPaymentMethodId: null
      })
    );
    customerId = customer.id;
  });

  afterEach(async () => {
    if (customerId) {
      // Invoices hold the customer under RESTRICT, so they go first; the
      // customer, its subscriptions and its cards then cascade from the user.
      await ds.getRepository(Invoice).delete({ customerId });
      customerId = undefined;
    }
    if (userId) {
      await ds.getRepository(User).delete({ id: userId });
      userId = undefined;
    }
  });

  afterAll(async () => {
    await ds?.getRepository(Plan).delete({ key: PLAN });
    await releaseDbLock?.();
    await ds?.destroy();
  });

  function firstPayment(paymentId: string, amountMinor: number) {
    return reducer.reduce({
      provider: 'yookassa',
      providerEventId: `payment.succeeded:${paymentId}`,
      type: 'invoice.paid',
      payload: {
        ref: { customerId, userId },
        providerInvoiceRef: paymentId,
        providerSubscriptionId: null,
        amountMinor,
        currency: 'RUB',
        periodStart: null,
        periodEnd: null,
        paidAt: new Date().toISOString(),
        savedPaymentMethod: {
          providerMethodRef: `pm_${paymentId}`,
          brand: 'Visa',
          last4: '4242'
        },
        planKey: PLAN
      }
    });
  }

  async function openRow(): Promise<Subscription> {
    return ds.getRepository(Subscription).findOneByOrFail({
      customerId,
      status: Not('canceled')
    });
  }

  it.each([
    ['cancelled during the trial', false],
    ['cancelled after the trial converted', true]
  ])(
    'gives no second trial to a customer who %s',
    async (_case, converted) => {
      await service.checkout(userId!, PLAN);
      expect(startCheckout).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        true
      );
      await firstPayment(`pay_trial_${String(converted)}`, 0);

      const trialRow = await openRow();
      expect(trialRow.status).toBe('trialing');
      const customer = await ds
        .getRepository(Customer)
        .findOneByOrFail({ id: customerId });
      expect(customer.trialUsedAt).toBeInstanceOf(Date);

      if (converted) {
        // The write of a trial conversion: the renewal clears `trial_end`.
        await ds
          .getRepository(Subscription)
          .update({ id: trialRow.id }, { status: 'active', trialEnd: null });
      }
      await service.cancelSubscription(userId!, 'immediate');

      await service.checkout(userId!, PLAN);
      expect(startCheckout).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        false
      );
      const second = await openRow();
      expect(second.status).toBe('incomplete');
      expect(second.trialEnd).toBeNull();

      await firstPayment(`pay_full_${String(converted)}`, 99000);
      expect((await openRow()).status).toBe('active');
    },
    30000
  );
});
