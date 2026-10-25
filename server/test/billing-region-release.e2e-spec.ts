// A user who leaves a YooKassa checkout unpaid keeps an `incomplete` row. A
// region change to another provider must release that row, as checkout does,
// and a first payment that arrives later must activate nothing. These cases
// run the real services against a real PostgreSQL.

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import type { BillingProviderId } from '@app/shared/types';
import { postgresConfig } from '../src/postgres.config';
import { User } from '../src/modules/users/entities/user.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { PaymentMethod } from '../src/modules/billing/entities/payment-method.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Product } from '../src/modules/billing/entities/product.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { BillingService } from '../src/modules/billing/billing.service';
import { FirstPaymentUnclaimedEvent } from '../src/modules/billing/events/billing.events';
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

const PLAN = 'region-release-pro';

runWithInfra('A region change releases an unpaid checkout (e2e)', () => {
  let ds: DataSource;
  let releaseDbLock: (() => Promise<void>) | undefined;
  let service: BillingUserService;
  let reducer: BillingEventReducer;
  let emit: jest.Mock;
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
        trialDays: 0,
        active: true,
        prices: { yookassa: { currency: 'RUB', amountMinor: 99000 } }
      })
    );
  }, BILLING_DB_LOCK_TIMEOUT_MS);

  beforeEach(async () => {
    emit = jest.fn();
    const provider = {
      id: 'yookassa',
      managesLifecycle: false,
      startCheckout: jest
        .fn()
        .mockResolvedValue({ url: 'https://checkout/x', sessionRef: 'sess-1' })
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
            resolveProvider: () => Promise.resolve(provider),
            isProviderAvailable: () => Promise.resolve(true),
            geoDefaultFor: (): BillingProviderId => 'yookassa',
            effectiveProviderId: (c: Customer): BillingProviderId =>
              c.providerOverride ?? 'yookassa'
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
        { provide: EventEmitter2, useValue: { emit } }
      ]
    }).compile();
    service = module.get(BillingUserService);
    reducer = module.get(BillingEventReducer);

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `region-release-${stamp}@example.com`,
        name: 'Region Release',
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

  function rows(): Promise<Subscription[]> {
    return ds.getRepository(Subscription).findBy({ customerId });
  }

  it('cancels the unpaid row and stores the new region', async () => {
    await service.checkout(userId!, PLAN);
    expect((await rows()).map((r) => r.status)).toEqual(['incomplete']);

    const region = await service.setRegion(userId!, 'world');

    expect(region).toMatchObject({
      region: 'world',
      effectiveProvider: 'paddle'
    });
    expect((await rows()).map((r) => r.status)).toEqual(['canceled']);
    const customer = await ds
      .getRepository(Customer)
      .findOneByOrFail({ id: customerId });
    expect(customer.providerOverride).toBe('paddle');
  });

  it('activates nothing when the first payment arrives after the release', async () => {
    await service.checkout(userId!, PLAN);
    await service.setRegion(userId!, 'world');

    await reducer.reduce({
      provider: 'yookassa',
      providerEventId: 'payment.succeeded:pay_late',
      type: 'invoice.paid',
      payload: {
        ref: { customerId, userId },
        providerInvoiceRef: 'pay_late',
        providerSubscriptionId: null,
        amountMinor: 99000,
        currency: 'RUB',
        periodStart: null,
        periodEnd: null,
        paidAt: new Date().toISOString(),
        savedPaymentMethod: null,
        planKey: PLAN
      }
    });

    expect((await rows()).map((r) => r.status)).toEqual(['canceled']);
    expect(emit).toHaveBeenCalledWith(
      FirstPaymentUnclaimedEvent.name,
      expect.any(FirstPaymentUnclaimedEvent)
    );
  });

  it('keeps the block once the checkout is paid', async () => {
    await service.checkout(userId!, PLAN);
    await ds
      .getRepository(Subscription)
      .update({ customerId }, { status: 'active' });

    await expect(service.setRegion(userId!, 'world')).rejects.toMatchObject({
      response: { errorKey: ErrorKeys.BILLING.REGION_CHANGE_BLOCKED }
    });
    expect((await rows()).map((r) => r.status)).toEqual(['active']);
  });
});
