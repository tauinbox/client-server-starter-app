// A plan change reads the subscription, calls the payment provider, then writes
// the row back - so anything committed during that round-trip used to be
// reverted. These cases run the real repository against a real PostgreSQL and
// commit the concurrent write from inside the provider stub, where the window is.

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConflictException } from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Like } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
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
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { ChargeDeclinedError } from '../src/modules/billing/providers/payment-provider.interface';
import { BillingUserService } from '../src/modules/billing/services/billing-user.service';
import { PlanChangeService } from '../src/modules/billing/services/plan-change.service';
import { CreditService } from '../src/modules/billing/services/credit.service';
import {
  BILLING_DB_LOCK_TIMEOUT_MS,
  holdBillingDbLock
} from './billing-db-lock';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

/** What the concurrent writer commits while the provider call is in flight. */
type ConcurrentWrite = (subscriptionId: string) => Promise<unknown>;

runWithInfra('Plan change vs. concurrent subscription writes (e2e)', () => {
  let ds: DataSource;
  let releaseDbLock: (() => Promise<void>) | undefined;
  let service: PlanChangeService;
  let users: BillingUserService;
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
    releaseDbLock = await holdBillingDbLock(ds);
  }, BILLING_DB_LOCK_TIMEOUT_MS);

  afterEach(async () => {
    jest.restoreAllMocks();
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
    await releaseDbLock?.();
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
    planKey = 'race-pro',
    status: Subscription['status'] = 'active'
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
        status,
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
      startCheckout: jest
        .fn()
        .mockResolvedValue({ url: 'https://checkout/x', sessionRef: 'sess-1' }),
      refund: jest.fn().mockResolvedValue(undefined),
      previewChangePlan: jest
        .fn()
        .mockResolvedValue({ amountMinor: 0, currency: 'RUB' }),
      cancel: jest.fn().mockResolvedValue(undefined)
    };
  }

  async function buildServices(
    provider: ReturnType<typeof providerStub>
  ): Promise<void> {
    const module = await Test.createTestingModule({
      providers: [
        PlanChangeService,
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
          useValue: {
            getProviderById: () => provider,
            resolveProvider: () => Promise.resolve(provider)
          }
        },
        {
          provide: CreditService,
          useValue: { getBalance: () => Promise.resolve(null) }
        },
        { provide: UsageRating, useValue: { summarizeForPeriod: jest.fn() } },
        {
          provide: RenewalService,
          useValue: { billClosingUsagePeriod: jest.fn() }
        },
        {
          provide: ConfigService,
          useValue: { get: () => 'http://localhost:4200' }
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } }
      ]
    }).compile();
    service = module.get(PlanChangeService);
    users = module.get(BillingUserService);
  }

  async function setup(
    providerId: 'yookassa' | 'paddle',
    duringCall: ConcurrentWrite | null,
    planKey = 'race-pro',
    status: Subscription['status'] = 'active'
  ): Promise<{
    subscription: Subscription;
    user: string;
    provider: ReturnType<typeof providerStub>;
  }> {
    await seedPlan('race-pro', 99000);
    await seedPlan('race-business', 290000);
    const subscription = await seedSubscription(providerId, planKey, status);
    const provider = providerStub(providerId, subscription.id, duringCall);
    await buildServices(provider);
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
      providerEventId: `change-charge:${subscription.id}:0:race-business`
    });
    // The insert omits refunded_minor and relies on the column default.
    expect(invoices[0].refundedMinor.toNumber()).toBe(0);
  }, 30000);

  it('commits the charge invoice before the provider is asked for the money', async () => {
    let recordedDuringCall: Invoice[] = [];
    const { subscription, user } = await setup('yookassa', async (id) => {
      recordedDuringCall = await ds
        .getRepository(Invoice)
        .find({ where: { subscriptionId: id } });
    });

    await service.changePlan(user, 'race-business');

    // Read from a pooled connection while the charge is in flight: the plant
    // is committed, so whatever ends the request from here on - the provider
    // deadline, a pool timeout, a restart - the payment stays on the books.
    expect(recordedDuringCall).toHaveLength(1);
    expect(recordedDuringCall[0]).toMatchObject({
      status: 'pending',
      providerInvoiceRef: '',
      paidAt: null,
      providerEventId: `change-charge:${subscription.id}:0:race-business`
    });
    expect(recordedDuringCall[0].amountMinor.toNumber()).toBeGreaterThan(0);

    const settled = await ds
      .getRepository(Invoice)
      .findOneOrFail({ where: { id: recordedDuringCall[0].id } });
    expect(settled).toMatchObject({
      status: 'paid',
      providerInvoiceRef: `pay_${subscription.id}`
    });
    expect(settled.paidAt).not.toBeNull();
  }, 30000);

  it('marks the planted charge failed when the provider declines the card', async () => {
    const { subscription, user, provider } = await setup('yookassa', null);
    provider.chargeOffSession.mockRejectedValue(
      new ChargeDeclinedError('declined')
    );

    await expect(
      service.changePlan(user, 'race-business')
    ).rejects.toBeInstanceOf(ChargeDeclinedError);

    // A decline is the one charge failure whose outcome is known: the row
    // reads failed instead of lingering as a payment the customer owes.
    const invoices = await ds
      .getRepository(Invoice)
      .find({ where: { subscriptionId: subscription.id } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      status: 'failed',
      providerInvoiceRef: ''
    });
    expect(await reload(subscription.id)).toMatchObject({
      planKey: 'race-pro'
    });
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
      // BillingAdminService reserves it, lands mid-flight. The switch's own
      // charge leg is already recorded by now but is excluded from the source
      // lookup by id, so the reservation still prices against the seeded one.
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
    expect(row.status).toBe('refunded');
  }, 30000);

  it('marks the source refunded only when the switch refunds all of it', async () => {
    const { subscription, user } = await setup(
      'yookassa',
      null,
      'race-business'
    );
    // The downgrade remainder of the business plan exceeds this source.
    const source = await seedSourceInvoice(subscription, 99000);

    await service.changePlan(user, 'race-pro');

    const full = await ds
      .getRepository(Invoice)
      .findOneOrFail({ where: { id: source.id } });
    expect(full.status).toBe('refunded');
    expect(full.refundedMinor.toNumber()).toBe(99000);
  }, 30000);

  it('keeps the source paid when the switch refunds only part of it', async () => {
    const { subscription, user } = await setup('yookassa', null);
    const source = await seedSourceInvoice(subscription, 99000);

    await service.changePlan(user, 'race-business');

    const partial = await ds
      .getRepository(Invoice)
      .findOneOrFail({ where: { id: source.id } });
    expect(partial.status).toBe('paid');
    expect(partial.refundedMinor.toNumber()).toBeGreaterThan(0);
    expect(partial.refundedMinor.toNumber()).toBeLessThan(99000);
  }, 30000);

  it('refuses a checkout whose incomplete row was activated inside the read-write window', async () => {
    const { subscription, user } = await setup(
      'yookassa',
      null,
      'race-pro',
      'incomplete'
    );
    const activatedAt = new Date(Date.now() - DAY_MS);
    // The success webhook commits between the pending-row read and the write
    // that reuses it - the only window checkout leaves open.
    const repo = ds.getRepository(Subscription);
    const read = repo.findOne.bind(repo);
    jest.spyOn(repo, 'findOne').mockImplementation(async (options) => {
      const row = await read(options);
      if (row?.status === 'incomplete') {
        await repo.update(
          { id: row.id },
          { status: 'active', currentPeriodStart: activatedAt }
        );
      }
      return row;
    });

    await expect(users.checkout(user, 'race-business')).rejects.toBeInstanceOf(
      ConflictException
    );

    expect(await reload(subscription.id)).toMatchObject({
      status: 'active',
      planKey: 'race-pro',
      currentPeriodStart: activatedAt
    });
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

  it('gives each switch of a period its own charge and refund keys', async () => {
    const { subscription, user, provider } = await setup('yookassa', null);
    await seedSourceInvoice(subscription, 99000);
    // The provider key store: a reused key returns the first payment.
    const payments = new Map<string, string>();
    provider.chargeOffSession.mockImplementation((...args: unknown[]) => {
      const key = args[4] as string;
      const ref = payments.get(key) ?? `pay_${payments.size + 1}`;
      payments.set(key, ref);
      return Promise.resolve({ providerInvoiceRef: ref, status: 'captured' });
    });

    for (const planKey of ['race-business', 'race-pro', 'race-business']) {
      await service.changePlan(user, planKey);
    }

    expect(payments.size).toBe(3);
    const refundKeys = provider.refund.mock.calls.map(
      (call: unknown[]) => call[2]
    );
    expect(new Set(refundKeys).size).toBe(3);
    const rows = await ds
      .getRepository(Invoice)
      .find({ where: { subscriptionId: subscription.id } });
    expect(rows).toHaveLength(7);
    const charges = rows.filter((row) =>
      row.providerEventId?.startsWith('change-charge:')
    );
    expect(charges.map((row) => row.providerInvoiceRef).sort()).toEqual([
      'pay_1',
      'pay_2',
      'pay_3'
    ]);
    expect(await reload(subscription.id)).toMatchObject({
      planKey: 'race-business',
      planChangeSeq: 3
    });
  }, 30000);

  /**
   * Makes the closing transaction of the first switch fail after the refund
   * was issued, then settles its charge as the confirming webhook does.
   */
  async function crashFirstSwitch(
    subscription: Subscription,
    user: string,
    provider: ReturnType<typeof providerStub>
  ): Promise<void> {
    let crashesLeft = 1;
    let crashNextTransaction = false;
    provider.refund.mockImplementation(() => {
      crashNextTransaction = crashesLeft-- > 0;
      return Promise.resolve(undefined);
    });
    const transaction = ds.transaction.bind(ds);
    jest.spyOn(ds, 'transaction').mockImplementation(((
      operation: (manager: EntityManager) => Promise<unknown>
    ) => {
      if (!crashNextTransaction) return transaction(operation);
      crashNextTransaction = false;
      return transaction(async (manager) => {
        await operation(manager);
        throw new Error('connection terminated');
      });
    }) as typeof ds.transaction);

    await expect(service.changePlan(user, 'race-business')).rejects.toThrow(
      'connection terminated'
    );
    await ds
      .getRepository(Invoice)
      .update(
        { providerEventId: `change-charge:${subscription.id}:0:race-business` },
        { status: 'paid', paidAt: new Date() }
      );
  }

  it('a retry after the closing transaction died neither charges nor reserves again', async () => {
    const { subscription, user, provider } = await setup('yookassa', null);
    const source = await seedSourceInvoice(subscription, 99000);
    await crashFirstSwitch(subscription, user, provider);
    await service.changePlan(user, 'race-business');

    expect(provider.chargeOffSession).toHaveBeenCalledTimes(1);
    expect(provider.refund.mock.calls).toEqual([
      [source.providerInvoiceRef, 66000, `change-refund:${subscription.id}:0`],
      [source.providerInvoiceRef, 66000, `change-refund:${subscription.id}:0`]
    ]);
    const invoices = ds.getRepository(Invoice);
    const sourceAfter = await invoices.findOneOrFail({
      where: { id: source.id }
    });
    expect(sourceAfter.status).toBe('paid');
    expect(sourceAfter.refundedMinor.toNumber()).toBe(66000);
    const leg = await invoices.findOneOrFail({
      where: { providerEventId: `change-refund:${subscription.id}:0` }
    });
    expect(leg.status).toBe('refunded');
    expect(leg.amountMinor.toNumber()).toBe(66000);
    expect(await reload(subscription.id)).toMatchObject({
      planKey: 'race-business',
      planChangeSeq: 1
    });
  }, 30000);

  it('refuses another target while a charged switch is unfinished, then finishes that switch', async () => {
    const { subscription, user, provider } = await setup('yookassa', null);
    await seedPlan('race-max', 500000);
    const source = await seedSourceInvoice(subscription, 99000);
    await crashFirstSwitch(subscription, user, provider);

    const unfinished = {
      response: { errorKey: ErrorKeys.BILLING.PLAN_CHANGE_UNFINISHED }
    };
    await expect(service.previewChange(user, 'race-max')).rejects.toMatchObject(
      unfinished
    );
    const refused = service.changePlan(user, 'race-max');
    await expect(refused).rejects.toBeInstanceOf(ConflictException);
    await expect(refused).rejects.toMatchObject(unfinished);
    expect(provider.chargeOffSession).toHaveBeenCalledTimes(1);
    expect(provider.refund).toHaveBeenCalledTimes(1);
    await expect(
      service.previewChange(user, 'race-business')
    ).resolves.toMatchObject({
      chargeMinor: 0,
      creditMinor: 66000,
      dueNowMinor: -66000
    });

    await service.changePlan(user, 'race-business');

    expect(provider.chargeOffSession).toHaveBeenCalledTimes(1);
    expect(
      provider.refund.mock.calls.map((call: unknown[]) => call[0])
    ).toEqual([source.providerInvoiceRef, source.providerInvoiceRef]);
    const charges = await ds.getRepository(Invoice).find({
      where: {
        subscriptionId: subscription.id,
        providerEventId: Like('change-charge:%')
      }
    });
    expect(charges).toHaveLength(1);
    expect(await reload(subscription.id)).toMatchObject({
      planKey: 'race-business',
      planChangeSeq: 1
    });
  }, 30000);

  it('lets a declined switch be followed by a switch to another target', async () => {
    const { subscription, user, provider } = await setup('yookassa', null);
    await seedPlan('race-max', 500000);
    provider.chargeOffSession.mockRejectedValueOnce(
      new ChargeDeclinedError('declined')
    );
    await expect(
      service.changePlan(user, 'race-business')
    ).rejects.toBeInstanceOf(ChargeDeclinedError);

    await service.changePlan(user, 'race-max');

    expect(provider.chargeOffSession).toHaveBeenCalledTimes(2);
    expect(await reload(subscription.id)).toMatchObject({
      planKey: 'race-max',
      planChangeSeq: 1
    });
  }, 30000);
});
