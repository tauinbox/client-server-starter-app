// The refusal of the saved card against a real PostgreSQL: the removal route
// service, the real webhook reducer and the real YooKassa provider (with a
// mocked client). A charge or a webhook that started before the removal must
// not use or save the card after it.

import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { openAdminDataSource } from './admin-data-source';
import { User } from '../src/modules/users/entities/user.entity';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { PaymentMethod } from '../src/modules/billing/entities/payment-method.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Product } from '../src/modules/billing/entities/product.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { BillingService } from '../src/modules/billing/billing.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import type {
  NormalizedInvoicePayload,
  NormalizedPaymentMethodPayload
} from '../src/modules/billing/providers/payment-provider.interface';
import { YooKassaProvider } from '../src/modules/billing/providers/yookassa.provider';
import { YOOKASSA_CLIENT } from '../src/modules/billing/providers/yookassa.client';
import { BillingConsentService } from '../src/modules/billing/services/billing-consent.service';
import { BillingUserService } from '../src/modules/billing/services/billing-user.service';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import {
  BILLING_DB_LOCK_TIMEOUT_MS,
  holdBillingDbLock
} from './billing-db-lock';
import { eventually } from './eventually';
import { repositoryProviders } from './repository-providers';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const PLAN = 'card-removal-pro';
const DAY_MS = 86_400_000;
const AUDIT = { actorEmail: 'removal@example.com', context: {} };

runWithInfra('Removal of the saved card (e2e)', () => {
  let ds: DataSource;
  let settingsDs: DataSource;
  let releaseDbLock: (() => Promise<void>) | undefined;
  let module: TestingModule;
  let service: BillingUserService;
  let reducer: BillingEventReducer;
  let yookassa: YooKassaProvider;
  let createPayment: jest.Mock;
  let userId: string | undefined;
  let customerId: string | undefined;

  beforeAll(async () => {
    ds = await openAdminDataSource('regional');
    settingsDs = await openAdminDataSource('settings');
    releaseDbLock = await holdBillingDbLock(ds);
    await settingsDs.getRepository(Plan).save(
      settingsDs.getRepository(Plan).create({
        key: PLAN,
        name: PLAN,
        description: null,
        billingMode: 'fixed',
        interval: 'month',
        entitlements: [],
        limits: null,
        trialDays: 0,
        active: true,
        prices: { yookassa: { currency: 'RUB', amountMinor: 99000 } }
      })
    );
  }, BILLING_DB_LOCK_TIMEOUT_MS);

  beforeEach(async () => {
    createPayment = jest.fn();

    module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        BillingUserService,
        BillingEventReducer,
        YooKassaProvider,
        AuditService,
        { provide: getDataSourceToken(), useValue: ds },
        { provide: DataSource, useValue: ds },
        ...repositoryProviders({ regional: ds, settings: settingsDs }, [
          Customer,
          Subscription,
          Invoice,
          PaymentMethod,
          Plan,
          Product,
          User,
          AuditLog
        ]),
        { provide: YOOKASSA_CLIENT, useValue: { createPayment } },
        { provide: BillingService, useValue: { getProviderById: jest.fn() } },
        { provide: CreditService, useValue: {} },
        { provide: BillingConsentService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
        {
          provide: MetricsService,
          useValue: {
            recordUnmatchedOffSessionCharge: jest.fn(),
            recordAuditWriteFailure: jest.fn()
          }
        }
      ]
    }).compile();
    await module.init();
    service = module.get(BillingUserService);
    reducer = module.get(BillingEventReducer);
    yookassa = module.get(YooKassaProvider);
  });

  afterEach(async () => {
    await module.close();

    if (customerId) {
      await ds.getRepository(Invoice).delete({ customerId });
      customerId = undefined;
    }

    if (userId) {
      await ds.getRepository(AuditLog).delete({ actorId: userId });
      await ds.getRepository(User).delete({ id: userId });
      userId = undefined;
    }
  });

  afterAll(async () => {
    await settingsDs?.getRepository(Plan).delete({ key: PLAN });
    await releaseDbLock?.();
    await settingsDs?.destroy();
    await ds?.destroy();
  });

  async function seed(
    status: Subscription['status']
  ): Promise<{ customer: Customer; subscription: Subscription }> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `card-removal-${stamp}@example.com`,
        name: 'Card Removal',
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
    const method = await ds.getRepository(PaymentMethod).save(
      ds.getRepository(PaymentMethod).create({
        customerId: customer.id,
        provider: 'yookassa',
        providerMethodRef: `pm_old_${stamp}`,
        brand: 'Visa',
        last4: '4242',
        isDefault: true
      })
    );

    await ds
      .getRepository(Customer)
      .update({ id: customer.id }, { defaultPaymentMethodId: method.id });
    const now = Date.now();
    const subscription = await ds.getRepository(Subscription).save(
      ds.getRepository(Subscription).create({
        customerId: customer.id,
        planKey: PLAN,
        provider: 'yookassa',
        billingMode: 'fixed',
        status,
        lifecycleOwner: 'self',
        currentPeriodStart: new Date(now - DAY_MS),
        currentPeriodEnd: new Date(now + 29 * DAY_MS),
        billingAnchorAt: new Date(now - DAY_MS),
        cancelAtPeriodEnd: false,
        trialEnd: null,
        providerSubscriptionId: null,
        paymentMethodId: status === 'incomplete' ? null : method.id
      })
    );

    return {
      customer: Object.assign(customer, { defaultPaymentMethodId: method.id }),
      subscription
    };
  }

  function rebind(consentedAt: string, ref: string) {
    const payload: NormalizedPaymentMethodPayload = {
      ref: { customerId, userId },
      savedPaymentMethod: {
        providerMethodRef: ref,
        brand: 'MasterCard',
        last4: '4444',
        consentedAt
      }
    };

    return reducer.reduce({
      provider: 'yookassa',
      providerEventId: `payment.succeeded:${ref}`,
      type: 'payment_method.updated',
      payload
    });
  }

  /** True once another backend waits for a lock that `pid` holds. */
  async function blockedBy(pid: number): Promise<boolean> {
    const blocked = await eventually(async () => {
      const [{ count }] = await ds.query<[{ count: number }]>(
        'SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
        [pid]
      );

      return count > 0 ? true : null;
    });

    return blocked === true;
  }

  function cards(): Promise<PaymentMethod[]> {
    return ds.getRepository(PaymentMethod).find({ where: { customerId } });
  }

  it('deletes the card, stamps the refusal, schedules the cancel and writes one audit row', async () => {
    const { subscription } = await seed('active');

    const result = await service.removePaymentMethod(userId!, AUDIT);

    expect(result?.cancelAtPeriodEnd).toBe(true);
    await expect(cards()).resolves.toEqual([]);
    const customer = await ds
      .getRepository(Customer)
      .findOneByOrFail({ id: customerId });

    expect(customer.defaultPaymentMethodId).toBeNull();
    expect(customer.paymentMethodRemovedAt).toBeInstanceOf(Date);
    const row = await ds
      .getRepository(Subscription)
      .findOneByOrFail({ id: subscription.id });

    expect(row.paymentMethodId).toBeNull();
    const audit = await ds
      .getRepository(AuditLog)
      .find({ where: { actorId: userId } });

    expect(audit.map(({ action }) => action)).toEqual([
      AuditAction.BILLING_PAYMENT_METHOD_REMOVE
    ]);
    expect(audit[0]?.details).toEqual({
      removedMethods: 1,
      cancelScheduled: true
    });

    // A repeat finds no card and writes nothing.
    await service.removePaymentMethod(userId!, AUDIT);
    await expect(
      ds.getRepository(AuditLog).count({ where: { actorId: userId } })
    ).resolves.toBe(1);
  });

  it('refuses an off-session charge that read the customer before the removal, before the provider call', async () => {
    // The renewal scan loads the customer and then charges it; the removal
    // commits in between.
    const { customer: staleCustomer } = await seed('active');

    await service.removePaymentMethod(userId!, AUDIT);

    await expect(
      yookassa.chargeOffSession(staleCustomer, {
        amountMinor: 99000,
        currency: 'RUB',
        receiptItems: [],
        idempotencyKey: 'renewal:removal-probe'
      })
    ).rejects.toMatchObject({
      response: { errorKey: ErrorKeys.BILLING.PAYMENT_METHOD_MISSING }
    });
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('activates a first payment created before the removal with no card, and ends it at the period close', async () => {
    const { subscription } = await seed('incomplete');
    const createdBeforeRemoval = new Date(Date.now() - 60_000).toISOString();

    await service.removePaymentMethod(userId!, AUDIT);
    const payload: NormalizedInvoicePayload = {
      ref: { customerId, userId },
      providerInvoiceRef: 'pay_late_first',
      providerSubscriptionId: null,
      amountMinor: 99000,
      currency: 'RUB',
      periodStart: null,
      periodEnd: null,
      paidAt: new Date().toISOString(),
      savedPaymentMethod: {
        providerMethodRef: 'pm_late_first',
        brand: 'Visa',
        last4: '1111',
        consentedAt: createdBeforeRemoval
      },
      planKey: PLAN
    };

    await reducer.reduce({
      provider: 'yookassa',
      providerEventId: 'payment.succeeded:pay_late_first',
      type: 'invoice.paid',
      payload
    });

    const row = await ds
      .getRepository(Subscription)
      .findOneByOrFail({ id: subscription.id });

    expect(row.status).toBe('active');
    expect(row.cancelAtPeriodEnd).toBe(true);
    expect(row.paymentMethodId).toBeNull();
    await expect(cards()).resolves.toEqual([]);
  });

  it('saves no card from a re-bind created before the removal, and saves one created after it', async () => {
    await seed('active');
    const createdBeforeRemoval = new Date(Date.now() - 60_000).toISOString();

    await service.removePaymentMethod(userId!, AUDIT);
    await rebind(createdBeforeRemoval, `pm_before_${customerId}`);

    await expect(cards()).resolves.toEqual([]);

    await rebind(
      new Date(Date.now() + 1000).toISOString(),
      `pm_after_${customerId}`
    );

    const saved = await cards();

    expect(saved.map(({ providerMethodRef }) => providerMethodRef)).toEqual([
      `pm_after_${customerId}`
    ]);
  });

  it('makes a re-bind that runs during the removal wait for its commit', async () => {
    await seed('active');
    const createdBeforeRemoval = new Date(Date.now() - 60_000).toISOString();
    // A second connection plays the removal: it holds the customer lock while
    // the re-bind runs, and commits the refusal after it.
    const removal = ds.createQueryRunner();

    await removal.connect();
    await removal.startTransaction();
    await removal.manager.findOne(Customer, {
      where: { id: customerId },
      lock: { mode: 'for_no_key_update' }
    });

    const [{ pid: removalPid }] = (await removal.query(
      'SELECT pg_backend_pid() AS pid'
    )) as [{ pid: number }];
    const pending = rebind(createdBeforeRemoval, `pm_race_${customerId}`);

    expect(await blockedBy(removalPid)).toBe(true);
    await removal.manager.delete(PaymentMethod, { customerId });
    await removal.manager.update(
      Customer,
      { id: customerId },
      { paymentMethodRemovedAt: new Date() }
    );
    await removal.commitTransaction();
    await removal.release();
    await pending;

    await expect(cards()).resolves.toEqual([]);
  });
});
