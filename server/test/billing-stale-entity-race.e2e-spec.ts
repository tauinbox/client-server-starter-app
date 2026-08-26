// Four write paths that loaded a row, awaited something, then committed the
// whole entity back - so `save`'s column diff reverted whatever another writer
// had committed meanwhile. These run the real services against a real
// PostgreSQL, committing the concurrent write from inside the window.

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import {
  DataSource,
  type EntityManager,
  type EntityTarget,
  type FindOneOptions,
  type ObjectLiteral
} from 'typeorm';
import { postgresConfig } from '../src/postgres.config';
import { User } from '../src/modules/users/entities/user.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { PaymentMethod } from '../src/modules/billing/entities/payment-method.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Product } from '../src/modules/billing/entities/product.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { BillingService } from '../src/modules/billing/billing.service';
import { ProrationCalculator } from '../src/modules/billing/rating/proration-calculator';
import { UsageRating } from '../src/modules/billing/rating/usage-rating.strategy';
import { BillingUserService } from '../src/modules/billing/services/billing-user.service';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import {
  InvoicePaidEvent,
  SubscriptionActivatedEvent
} from '../src/modules/billing/events/billing.events';
import type {
  NormalizedInvoicePayload,
  NormalizedPaymentMethodPayload,
  NormalizedSubscriptionPayload
} from '../src/modules/billing/providers/payment-provider.interface';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const DAY_MS = 86_400_000;
const PLAN_KEY = 'stale-race-pro';

runWithInfra('Billing writes vs. concurrently committed columns (e2e)', () => {
  let ds: DataSource;
  let userId: string | undefined;
  let customerId: string | undefined;
  let subscriptionId: string;
  let providerSubscriptionRef: string;
  let emit: jest.Mock;

  const periodStart = new Date(Date.now() - 10 * DAY_MS);
  const periodEnd = new Date(Date.now() + 20 * DAY_MS);

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
    await ds.getRepository(Plan).save(
      ds.getRepository(Plan).create({
        key: PLAN_KEY,
        name: PLAN_KEY,
        description: null,
        billingMode: 'fixed',
        interval: 'month',
        meterKey: null,
        entitlements: [],
        limits: null,
        trialDays: 0,
        active: true,
        prices: {
          yookassa: { currency: 'RUB', amountMinor: 99000 },
          paddle: {
            currency: 'USD',
            amountMinor: 99000,
            providerPriceId: `pri_${PLAN_KEY}`
          }
        }
      })
    );
  }, 30000);

  beforeEach(async () => {
    emit = jest.fn();
    await seed();
    await warmPool();
  });

  afterEach(async () => {
    if (customerId) {
      // Invoices hold the customer under RESTRICT, so they go first; the
      // customer and its subscription then cascade from the user.
      await ds.getRepository(Invoice).delete({ customerId });
      await ds
        .getRepository(Subscription)
        .update({ customerId }, { paymentMethodId: null });
      await ds
        .getRepository(Customer)
        .update({ id: customerId }, { defaultPaymentMethodId: null });
      await ds.getRepository(PaymentMethod).delete({ customerId });
      customerId = undefined;
    }
    if (userId) {
      await ds.getRepository(User).delete({ id: userId });
      userId = undefined;
    }
  });

  afterAll(async () => {
    await ds?.getRepository(Plan).delete({ key: PLAN_KEY });
    await ds?.destroy();
  });

  /**
   * The second connection has to exist before the race starts: opening one
   * costs more than the whole write it would carry, so on a cold pool the
   * concurrent write lands after the path under test has already committed.
   */
  async function warmPool(): Promise<void> {
    const runners = [ds.createQueryRunner(), ds.createQueryRunner()];
    await Promise.all(runners.map((r) => r.connect()));
    await Promise.all(runners.map((r) => r.release()));
  }

  async function seed(): Promise<void> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    providerSubscriptionRef = `sub_${stamp}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `stale-race-${stamp}@example.com`,
        firstName: 'Stale',
        lastName: 'Race',
        password: 'hashed'
      })
    );
    userId = user.id;

    const customer = await ds.getRepository(Customer).save(
      ds.getRepository(Customer).create({
        userId: user.id,
        provider: 'yookassa',
        providerOverride: null,
        providerCustomerId: `cus_${stamp}`,
        country: 'RU',
        currency: 'RUB',
        defaultPaymentMethodId: null
      })
    );
    customerId = customer.id;

    const subscription = await ds.getRepository(Subscription).save(
      ds.getRepository(Subscription).create({
        customerId: customer.id,
        planKey: PLAN_KEY,
        provider: 'yookassa',
        billingMode: 'fixed',
        status: 'active',
        lifecycleOwner: 'self',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        billingAnchorAt: periodStart,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        providerSubscriptionId: providerSubscriptionRef,
        paymentMethodId: null,
        version: 1,
        dunningAttempts: 0,
        nextRenewalAttemptAt: null
      })
    );
    subscriptionId = subscription.id;
  }

  function reload(): Promise<Subscription | null> {
    return ds.getRepository(Subscription).findOne({
      where: { id: subscriptionId }
    });
  }

  /**
   * Commits `duringWindow` on a second connection once the path under test has
   * read its `Subscription` - the interleaving the production window allows,
   * made deterministic. Everything after that read is the window.
   */
  function racingManager(
    manager: EntityManager,
    duringWindow: () => Promise<unknown>
  ): EntityManager {
    const read = manager.findOne.bind(manager);
    let fired = false;
    // Patching the instance, not a proxy: the manager is created per
    // transaction, so nothing outside this call sees the hook.
    manager.findOne = async <T extends ObjectLiteral>(
      entity: EntityTarget<T>,
      options: FindOneOptions<T>
    ): Promise<T | null> => {
      const found = await read(entity, options);
      if (!fired && entity === Subscription && found) {
        fired = true;
        await duringWindow();
      }
      return found;
    };
    return manager;
  }

  async function buildReducer(
    duringWindow: () => Promise<unknown>
  ): Promise<BillingEventReducer> {
    const module = await Test.createTestingModule({
      providers: [
        BillingEventReducer,
        {
          provide: MetricsService,
          useValue: { recordUnmatchedOffSessionCharge: jest.fn() }
        },
        {
          provide: getDataSourceToken(),
          useValue: {
            transaction: <T>(cb: (m: EntityManager) => Promise<T>) =>
              ds.transaction((m) => cb(racingManager(m, duringWindow)))
          }
        },
        {
          provide: CreditService,
          useValue: { addPurchase: jest.fn(), spendOnUsage: jest.fn() }
        },
        { provide: EventEmitter2, useValue: { emit } }
      ]
    }).compile();
    return module.get(BillingEventReducer);
  }

  async function buildUserService(
    duringWindow: () => Promise<unknown>
  ): Promise<BillingUserService> {
    const subscriptions = ds.getRepository(Subscription);
    // `setRegion` reads the open subscription and nothing else off this
    // repository, so the stub carries only that read plus the window hook.
    const racingSubscriptions = {
      findOne: async (options: FindOneOptions<Subscription>) => {
        const found = await subscriptions.findOne(options);
        await duringWindow();
        return found;
      }
    };

    const module = await Test.createTestingModule({
      providers: [
        BillingUserService,
        ProrationCalculator,
        { provide: getDataSourceToken(), useValue: ds },
        {
          provide: getRepositoryToken(Customer),
          useValue: ds.getRepository(Customer)
        },
        {
          provide: getRepositoryToken(Subscription),
          useValue: racingSubscriptions
        },
        {
          provide: getRepositoryToken(Invoice),
          useValue: ds.getRepository(Invoice)
        },
        {
          provide: getRepositoryToken(PaymentMethod),
          useValue: ds.getRepository(PaymentMethod)
        },
        { provide: getRepositoryToken(Plan), useValue: ds.getRepository(Plan) },
        {
          provide: getRepositoryToken(Product),
          useValue: ds.getRepository(Product)
        },
        { provide: getRepositoryToken(User), useValue: ds.getRepository(User) },
        {
          provide: BillingService,
          useValue: {
            geoDefaultFor: () => 'paddle',
            effectiveProviderId: (customer: Customer) =>
              customer.providerOverride ?? 'paddle',
            getProviderById: () => null,
            resolveProvider: () => Promise.resolve(null)
          }
        },
        {
          provide: CreditService,
          useValue: { getBalance: () => Promise.resolve(null) }
        },
        {
          provide: RenewalService,
          useValue: { billClosingUsagePeriod: jest.fn() }
        },
        { provide: UsageRating, useValue: { summarizeForPeriod: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: () => 'http://localhost:4200' }
        },
        { provide: EventEmitter2, useValue: { emit } }
      ]
    }).compile();
    return module.get(BillingUserService);
  }

  async function seedPaymentMethod(ref: string): Promise<PaymentMethod> {
    const repo = ds.getRepository(PaymentMethod);
    return repo.save(
      repo.create({
        customerId: customerId as string,
        provider: 'yookassa',
        providerMethodRef: ref,
        brand: 'Visa',
        last4: '4242',
        isDefault: true
      })
    );
  }

  function subscriptionPayload(
    overrides: Partial<NormalizedSubscriptionPayload> = {}
  ): NormalizedSubscriptionPayload {
    return {
      ref: { customerId, userId },
      providerSubscriptionId: providerSubscriptionRef,
      status: 'active',
      planKey: PLAN_KEY,
      currentPeriodStart: periodStart.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      cancelAtPeriodEnd: false,
      trialEnd: null,
      ...overrides
    };
  }

  it('keeps dunning bookkeeping committed while a subscription snapshot is applied', async () => {
    const attemptAt = new Date('2026-06-20T00:00:00.000Z');
    const reducer = await buildReducer(() =>
      ds
        .getRepository(Subscription)
        .update(
          { id: subscriptionId },
          { dunningAttempts: 2, nextRenewalAttemptAt: attemptAt, version: 9 }
        )
    );
    const renewedEnd = new Date(periodEnd.getTime() + 30 * DAY_MS);

    await reducer.reduce({
      provider: 'yookassa',
      providerEventId: `evt-renew-${subscriptionId}`,
      type: 'subscription.renewed',
      payload: subscriptionPayload({
        currentPeriodEnd: renewedEnd.toISOString()
      })
    });

    // The snapshot's own columns land; the local-only bookkeeping survives.
    expect(await reload()).toMatchObject({
      currentPeriodEnd: renewedEnd,
      dunningAttempts: 2,
      nextRenewalAttemptAt: attemptAt,
      version: 9
    });
  }, 30000);

  it('does not resurrect a subscription cancelled while a card re-bind is in flight', async () => {
    const oldMethod = await seedPaymentMethod('tok-old');
    await ds
      .getRepository(Subscription)
      .update({ id: subscriptionId }, { paymentMethodId: oldMethod.id });
    const reducer = await buildReducer(() =>
      ds
        .getRepository(Subscription)
        .update({ id: subscriptionId }, { status: 'canceled' })
    );
    const payload: NormalizedPaymentMethodPayload = {
      ref: { customerId, userId },
      savedPaymentMethod: {
        providerMethodRef: 'tok-new',
        brand: 'MasterCard',
        last4: '4444'
      }
    };

    await reducer.reduce({
      provider: 'yookassa',
      providerEventId: `evt-method-${subscriptionId}`,
      type: 'payment_method.updated',
      payload
    });

    // The cancel wins the row outright: a closed subscription is not a place
    // to move an autopay pointer to.
    expect(await reload()).toMatchObject({
      status: 'canceled',
      paymentMethodId: oldMethod.id
    });
    // The customer-level pointer is a different row and still moves.
    const customer = await ds
      .getRepository(Customer)
      .findOneOrFail({ where: { id: customerId } });
    expect(customer.defaultPaymentMethodId).not.toBe(oldMethod.id);
  }, 30000);

  it('does not activate a subscription cancelled while the first payment stored its card', async () => {
    await ds
      .getRepository(Subscription)
      .update({ id: subscriptionId }, { status: 'incomplete' });
    const reducer = await buildReducer(() =>
      ds
        .getRepository(Subscription)
        .update({ id: subscriptionId }, { status: 'canceled' })
    );
    const payload: NormalizedInvoicePayload = {
      ref: { customerId, userId },
      providerInvoiceRef: `pay_${subscriptionId}`,
      providerSubscriptionId: null,
      amountMinor: 99000,
      currency: 'RUB',
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      paidAt: new Date().toISOString(),
      savedPaymentMethod: {
        providerMethodRef: 'pm_tok',
        brand: 'Visa',
        last4: '4242'
      }
    };

    await reducer.reduce({
      provider: 'yookassa',
      providerEventId: `evt-paid-${subscriptionId}`,
      type: 'invoice.paid',
      payload
    });

    expect(await reload()).toMatchObject({ status: 'canceled' });
    // The money still landed, so the invoice event stands; the activation the
    // cancel took away must not be announced.
    expect(emit).toHaveBeenCalledWith(
      InvoicePaidEvent.name,
      expect.objectContaining({ userId })
    );
    expect(emit).not.toHaveBeenCalledWith(
      SubscriptionActivatedEvent.name,
      expect.anything()
    );
  }, 30000);

  it('keeps a default payment method committed while the region is being changed', async () => {
    const method = await seedPaymentMethod('tok-region');
    const service = await buildUserService(() =>
      ds
        .getRepository(Customer)
        .update({ id: customerId }, { defaultPaymentMethodId: method.id })
    );

    const region = await service.setRegion(userId as string, 'ru');

    expect(region.region).toBe('ru');
    const customer = await ds
      .getRepository(Customer)
      .findOneOrFail({ where: { id: customerId } });
    expect(customer).toMatchObject({
      providerOverride: 'yookassa',
      defaultPaymentMethodId: method.id
    });
  }, 30000);
});
