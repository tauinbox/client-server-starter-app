// A plan change reads the subscription, calls the payment provider, then writes
// the row back - so anything committed during that round-trip used to be
// reverted. These cases run the real repository against a real PostgreSQL and
// commit the concurrent write from inside the provider stub, where the window is.

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConflictException } from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Money } from '@app/shared/utils/money';
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

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

/** What the concurrent writer commits while the provider call is in flight. */
type ConcurrentWrite = (subscriptionId: string) => Promise<unknown>;

runWithInfra('Plan change vs. concurrent subscription writes (e2e)', () => {
  let ds: DataSource;
  let service: BillingUserService;
  let userId: string | undefined;
  let customerId: string | undefined;
  let planKeys: string[] = [];

  // The window only exists while the period still has days left: a period in
  // the past prorates to zero and the provider is never called.
  const DAY_MS = 86_400_000;
  const periodStart = new Date(Date.now() - 10 * DAY_MS);
  const periodEnd = new Date(Date.now() + 20 * DAY_MS);

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
  }, 30000);

  afterEach(async () => {
    if (customerId) {
      // Invoices hold the customer under RESTRICT, so they go first; the
      // customer and its subscription then cascade from the user.
      await ds.getRepository(Invoice).delete({ customerId });
      customerId = undefined;
    }
    if (userId) {
      await ds.getRepository(User).delete({ id: userId });
      userId = undefined;
    }
    if (planKeys.length > 0) {
      await ds.getRepository(Plan).delete(planKeys.map((key) => ({ key })));
      planKeys = [];
    }
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  /**
   * The second connection has to exist before the race starts: opening one
   * costs more than the whole write it would carry, so on a cold pool the
   * concurrent write lands after the change has already committed.
   */
  async function warmPool(): Promise<void> {
    const runners = [ds.createQueryRunner(), ds.createQueryRunner()];
    await Promise.all(runners.map((r) => r.connect()));
    await Promise.all(runners.map((r) => r.release()));
  }

  async function seedPlan(key: string, amountMinor: number): Promise<Plan> {
    planKeys.push(key);
    return ds.getRepository(Plan).save(
      ds.getRepository(Plan).create({
        key,
        name: key,
        description: null,
        billingMode: 'fixed',
        interval: 'month',
        meterKey: null,
        entitlements: [],
        limits: null,
        trialDays: 0,
        active: true,
        prices: {
          yookassa: { currency: 'RUB', amountMinor },
          paddle: {
            currency: 'USD',
            amountMinor,
            providerPriceId: `pri_${key}`
          }
        }
      })
    );
  }

  async function seedSubscription(
    provider: 'yookassa' | 'paddle',
    planKey = 'race-pro'
  ): Promise<Subscription> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `plan-change-race-${stamp}@example.com`,
        firstName: 'Plan',
        lastName: 'Race',
        password: 'hashed'
      })
    );
    userId = user.id;

    const customer = await ds.getRepository(Customer).save(
      ds.getRepository(Customer).create({
        userId: user.id,
        provider,
        providerOverride: null,
        providerCustomerId: `cus_${stamp}`,
        country: provider === 'yookassa' ? 'RU' : 'US',
        currency: provider === 'yookassa' ? 'RUB' : 'USD',
        defaultPaymentMethodId: null
      })
    );
    customerId = customer.id;

    return ds.getRepository(Subscription).save(
      ds.getRepository(Subscription).create({
        customerId: customer.id,
        planKey,
        provider,
        billingMode: 'fixed',
        status: 'active',
        lifecycleOwner: provider === 'yookassa' ? 'self' : 'provider',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        providerSubscriptionId: provider === 'paddle' ? `sub_${stamp}` : null,
        paymentMethodId: null,
        version: 1,
        dunningAttempts: 0,
        nextRenewalAttemptAt: null
      })
    );
  }

  /**
   * A provider whose in-flight call commits `duringCall` - the interleaving the
   * production window allows, made deterministic.
   */
  function providerStub(
    id: 'yookassa' | 'paddle',
    subscriptionId: string,
    duringCall: ConcurrentWrite | null
  ) {
    const runConcurrentWrite = async (): Promise<void> => {
      if (duringCall) await duringCall(subscriptionId);
    };
    return {
      id,
      managesLifecycle: id === 'paddle',
      chargeOffSession: jest.fn(async () => {
        await runConcurrentWrite();
        return {
          providerInvoiceRef: `pay_${subscriptionId}`,
          status: 'captured'
        };
      }),
      changePlan: jest.fn(async () => {
        await runConcurrentWrite();
      }),
      refund: jest.fn().mockResolvedValue(undefined),
      previewChangePlan: jest
        .fn()
        .mockResolvedValue({ amountMinor: 0, currency: 'RUB' }),
      cancel: jest.fn().mockResolvedValue(undefined)
    };
  }

  async function buildService(
    provider: ReturnType<typeof providerStub>
  ): Promise<BillingUserService> {
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
          useValue: ds.getRepository(Subscription)
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
          useValue: { getProviderById: () => provider }
        },
        {
          provide: CreditService,
          useValue: { getBalance: () => Promise.resolve(null) }
        },
        { provide: UsageRating, useValue: { summarizeForPeriod: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: () => 'http://localhost:4200' }
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } }
      ]
    }).compile();
    return module.get(BillingUserService);
  }

  async function setup(
    providerId: 'yookassa' | 'paddle',
    duringCall: ConcurrentWrite | null,
    planKey = 'race-pro'
  ): Promise<{
    subscription: Subscription;
    user: string;
    provider: ReturnType<typeof providerStub>;
  }> {
    await seedPlan('race-pro', 99000);
    await seedPlan('race-business', 290000);
    const subscription = await seedSubscription(providerId, planKey);
    const provider = providerStub(providerId, subscription.id, duringCall);
    service = await buildService(provider);
    await warmPool();
    return { subscription, user: userId as string, provider };
  }

  /** The paid fixed invoice a downgrade's proration refund targets. */
  async function seedSourceInvoice(
    subscription: Subscription,
    amountMinor: number
  ): Promise<Invoice> {
    const repo = ds.getRepository(Invoice);
    return repo.save(
      repo.create({
        customerId: subscription.customerId,
        subscriptionId: subscription.id,
        provider: subscription.provider,
        providerEventId: `source-${subscription.id}`,
        providerInvoiceRef: `pay_source_${subscription.id}`,
        amountMinor: Money.fromMinor(amountMinor),
        refundedMinor: Money.fromMinor(0),
        currency: 'RUB',
        status: 'paid',
        creditUnitsApplied: 0,
        billingMode: 'fixed',
        kind: 'subscription',
        productId: null,
        periodStart,
        periodEnd,
        paidAt: periodStart,
        receiptRef: null
      })
    );
  }

  function reload(id: string): Promise<Subscription | null> {
    return ds.getRepository(Subscription).findOne({ where: { id } });
  }

  it('keeps a period-end cancellation committed while the charge was in flight', async () => {
    // A whole-entity save, the shape every cancel path used to have.
    const { subscription, user } = await setup('yookassa', async (id) => {
      const repo = ds.getRepository(Subscription);
      const row = await repo.findOneOrFail({ where: { id } });
      row.cancelAtPeriodEnd = true;
      await repo.save(row);
    });

    await expect(
      service.changePlan(user, 'race-business')
    ).rejects.toBeInstanceOf(ConflictException);

    const row = await reload(subscription.id);
    expect(row).toMatchObject({
      cancelAtPeriodEnd: true,
      status: 'active',
      planKey: 'race-pro'
    });
  }, 30000);

  it('keeps an immediate cancellation and does not resurrect the subscription', async () => {
    const { subscription, user } = await setup('yookassa', (id) =>
      ds
        .getRepository(Subscription)
        .update({ id }, { status: 'canceled', cancelAtPeriodEnd: false })
    );

    await expect(
      service.changePlan(user, 'race-business')
    ).rejects.toBeInstanceOf(ConflictException);

    const row = await reload(subscription.id);
    expect(row).toMatchObject({ status: 'canceled', planKey: 'race-pro' });
  }, 30000);

  it('records the charge that already left the card even when the switch is refused', async () => {
    const { subscription, user } = await setup('yookassa', (id) =>
      ds.getRepository(Subscription).update({ id }, { cancelAtPeriodEnd: true })
    );

    await expect(
      service.changePlan(user, 'race-business')
    ).rejects.toBeInstanceOf(ConflictException);

    const invoices = await ds.getRepository(Invoice).find({
      where: { subscriptionId: subscription.id }
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      status: 'paid',
      providerEventId: `change-charge:${subscription.id}:race-business:${periodEnd.getTime()}`
    });
    // The insert omits refunded_minor and relies on the column default.
    expect(invoices[0].refundedMinor.toNumber()).toBe(0);
  }, 30000);

  it('leaves dunning bookkeeping written during the window intact when the switch lands', async () => {
    const attemptAt = new Date('2026-06-20T00:00:00Z');
    const { subscription, user } = await setup('yookassa', (id) =>
      ds
        .getRepository(Subscription)
        .update({ id }, { dunningAttempts: 2, nextRenewalAttemptAt: attemptAt })
    );

    const result = await service.changePlan(user, 'race-business');

    expect(result.planKey).toBe('race-business');
    const row = await reload(subscription.id);
    expect(row).toMatchObject({
      planKey: 'race-business',
      dunningAttempts: 2,
      nextRenewalAttemptAt: attemptAt
    });
  }, 30000);

  it('applies the switch untouched when nothing else writes the row', async () => {
    const { subscription, user } = await setup('yookassa', null);

    const result = await service.changePlan(user, 'race-business');

    expect(result.planKey).toBe('race-business');
    expect(await reload(subscription.id)).toMatchObject({
      planKey: 'race-business',
      cancelAtPeriodEnd: false,
      status: 'active'
    });
  }, 30000);

  it('prices the proration refund against a refund committed during the provider call', async () => {
    const { subscription, user, provider } = await setup(
      'yookassa',
      // An admin refund of the same source invoice, reserved the way
      // BillingAdminService reserves it, lands mid-flight. The charge invoice
      // does not exist yet, so this only touches the refund source.
      (subscriptionId) =>
        ds
          .getRepository(Invoice)
          .update(
            { subscriptionId },
            { refundedMinor: Money.fromMinor(80000) }
          ),
      'race-business'
    );
    const source = await seedSourceInvoice(subscription, 99000);

    await service.changePlan(user, 'race-pro');

    // Only 19000 of the source is still refundable once the concurrent leg is
    // accounted for; pricing against the pre-call read refunded the whole
    // 99000 on top of it.
    expect(provider.refund).toHaveBeenCalledWith(
      source.providerInvoiceRef,
      19000,
      expect.any(String)
    );
    const row = await ds
      .getRepository(Invoice)
      .findOneOrFail({ where: { id: source.id } });
    expect(row.refundedMinor.toNumber()).toBe(99000);
  }, 30000);

  it('keeps a cancellation committed while the provider-managed change was in flight', async () => {
    const { subscription, user } = await setup('paddle', (id) =>
      ds.getRepository(Subscription).update({ id }, { cancelAtPeriodEnd: true })
    );

    await expect(
      service.changePlan(user, 'race-business')
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await reload(subscription.id)).toMatchObject({
      cancelAtPeriodEnd: true,
      planKey: 'race-pro'
    });
  }, 30000);
});
