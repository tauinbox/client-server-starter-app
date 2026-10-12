// A usage record whose window check passed must not be stored after a close
// rated that window. Either the close waits and rates the record, or the
// record sees the closed window and is refused.

import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntitySubscriberInterface } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import { ErrorKeys } from '@app/shared/constants';
import { postgresConfig } from '../src/postgres.config';
import { User } from '../src/modules/users/entities/user.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { CreditBalance } from '../src/modules/billing/entities/credit-balance.entity';
import { CreditLedger } from '../src/modules/billing/entities/credit-ledger.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { PaymentMethod } from '../src/modules/billing/entities/payment-method.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { UsageRecord } from '../src/modules/billing/entities/usage-record.entity';
import { WebhookEvent } from '../src/modules/billing/entities/webhook-event.entity';
import { BillingService } from '../src/modules/billing/billing.service';
import { UsagePeriodClosedEvent } from '../src/modules/billing/events/billing.events';
import { BILLING_PROVIDERS } from '../src/modules/billing/providers/payment-provider.interface';
import { FixedRating } from '../src/modules/billing/rating/fixed-rating.strategy';
import { UsageRating } from '../src/modules/billing/rating/usage-rating.strategy';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { BillingAdminService } from '../src/modules/billing/services/billing-admin.service';
import { UsageInvoicingService } from '../src/modules/billing/services/usage-invoicing.service';
import { UsageService } from '../src/modules/billing/services/usage.service';
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { EntitlementService } from '../src/modules/entitlements/entitlement.service';
import {
  BILLING_DB_LOCK_TIMEOUT_MS,
  holdBillingDbLock
} from './billing-db-lock';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const DAY_MS = 86_400_000;
const PLAN_KEY = 'window-race-usage';
const METER = 'window-race-calls';
const LATE_KEY = 'window-race-late';
// 100 seeded units plus 30 late ones, less 50 prepaid credits, at 200 each.
const WITH_LATE_MINOR = (100 + 30 - 50) * 200;
const WITHOUT_LATE_MINOR = (100 - 50) * 200;

type Provider = 'yookassa' | 'paddle';

runWithInfra('Usage ingest vs. the close of its metered window (e2e)', () => {
  let ds: DataSource;
  let releaseDbLock: (() => Promise<void>) | undefined;
  let userId: string | undefined;
  let customerId: string | undefined;
  let subscription: Subscription;
  let insertGate: ReturnType<typeof gate> | null = null;

  /**
   * Holds the insert of the late record inside the ingest transaction, after
   * its window check passed, until the test releases it.
   */
  const holdLateInsert: EntitySubscriberInterface<UsageRecord> = {
    listenTo: () => UsageRecord,
    beforeInsert: async (event) => {
      if (insertGate && event.entity?.idempotencyKey === LATE_KEY) {
        insertGate.enter();
        await insertGate.released;
      }
    }
  };

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
    ds.subscribers.push(holdLateInsert);
    releaseDbLock = await holdBillingDbLock(ds);
    await ds.getRepository(Plan).save(
      ds.getRepository(Plan).create({
        key: PLAN_KEY,
        name: PLAN_KEY,
        description: null,
        billingMode: 'usage',
        interval: 'month',
        meterKey: METER,
        entitlements: [],
        limits: null,
        trialDays: 0,
        active: true,
        prices: {
          yookassa: {
            currency: 'RUB',
            amountMinor: 0,
            unitPriceMinor: 200,
            includedUnits: 0
          },
          paddle: {
            currency: 'USD',
            amountMinor: 0,
            unitPriceMinor: 200,
            includedUnits: 0
          }
        }
      })
    );
  }, BILLING_DB_LOCK_TIMEOUT_MS);

  afterEach(async () => {
    insertGate?.release();
    insertGate = null;
    if (customerId) {
      // Invoices and ledger rows hold the customer under RESTRICT, so they go
      // first; the rest cascades from the user.
      await ds.getRepository(CreditLedger).delete({ customerId });
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
    await releaseDbLock?.();
    await ds?.destroy();
  });

  function gate() {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    return { release, released, enter, entered };
  }

  /**
   * A usage subscription with 100 units at the start of its window and a
   * balance of 50 prepaid credits.
   */
  async function seed(opts: {
    provider: Provider;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<void> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `window-race-${stamp}@example.com`,
        firstName: 'Window',
        lastName: 'Race',
        password: 'hashed'
      })
    );
    userId = user.id;

    const customer = await ds.getRepository(Customer).save(
      ds.getRepository(Customer).create({
        userId: user.id,
        provider: opts.provider,
        providerOverride: null,
        providerCustomerId: `cus_${stamp}`,
        country: 'RU',
        currency: 'RUB',
        defaultPaymentMethodId: null
      })
    );
    customerId = customer.id;

    const selfManaged = opts.provider === 'yookassa';
    subscription = await ds.getRepository(Subscription).save(
      ds.getRepository(Subscription).create({
        customerId: customer.id,
        planKey: PLAN_KEY,
        provider: opts.provider,
        billingMode: 'usage',
        status: 'active',
        lifecycleOwner: selfManaged ? 'self' : 'provider',
        currentPeriodStart: opts.periodStart,
        currentPeriodEnd: opts.periodEnd,
        billingAnchorAt: selfManaged ? opts.periodStart : null,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        providerSubscriptionId: selfManaged ? null : `sub_${stamp}`,
        paymentMethodId: null,
        version: 1,
        dunningAttempts: 0,
        nextRenewalAttemptAt: null
      })
    );

    await ds.getRepository(UsageRecord).save(
      ds.getRepository(UsageRecord).create({
        customerId: customer.id,
        subscriptionId: subscription.id,
        meterKey: METER,
        quantity: Money.fromMinor(100),
        occurredAt: new Date(opts.periodStart.getTime() + 60_000),
        idempotencyKey: `window-race-${stamp}`
      })
    );

    const purchase = await ds.getRepository(Invoice).save(
      ds.getRepository(Invoice).create({
        customerId: customer.id,
        subscriptionId: null,
        provider: opts.provider,
        providerEventId: `window-race-credits-${stamp}`,
        providerInvoiceRef: 'pay_credits',
        amountMinor: Money.fromMinor(5000),
        currency: 'RUB',
        status: 'paid',
        billingMode: 'fixed',
        kind: 'one_time',
        periodStart: new Date(),
        periodEnd: new Date(),
        paidAt: new Date(),
        receiptRef: null
      })
    );
    await ds.transaction((m) =>
      new CreditService(ds.getRepository(CreditBalance)).addPurchase(
        m,
        customer.id,
        purchase.id,
        50
      )
    );
  }

  /** A provider whose first off-session charge can be held by the test. */
  function provider(id: Provider) {
    const charge = gate();
    let calls = 0;
    const amounts: number[] = [];
    const recordAmount = (amountMinor: number) => {
      amounts.push(amountMinor);
      calls += 1;
    };
    const value = {
      id,
      managesLifecycle: id === 'paddle',
      chargeOffSession: jest.fn(
        async (_customer: Customer, amountMinor: number) => {
          recordAmount(amountMinor);
          if (calls === 1) {
            charge.enter();
            await charge.released;
          }
          return { providerInvoiceRef: `pay_${calls}`, status: 'captured' };
        }
      ),
      chargeUsage: jest.fn((_ref: string, amountMinor: number) => {
        recordAmount(amountMinor);
        return Promise.resolve(undefined);
      }),
      findOffSessionCharge: jest.fn(() => Promise.resolve(null)),
      getOffSessionCharge: jest.fn(() => Promise.resolve(null)),
      cancel: jest.fn(() => Promise.resolve(undefined))
    };
    return { value, amounts, charge };
  }

  /**
   * Other suites seed due subscriptions in the same database, so the scan
   * must see only the row this test owns.
   */
  function scopedSubscriptions() {
    const subscriptions = ds.getRepository(Subscription);
    return subscriptions.extend({
      createQueryBuilder(alias: string) {
        const qb = subscriptions.createQueryBuilder(alias);
        const getMany = qb.getMany.bind(qb);
        qb.getMany = async () =>
          (await getMany()).filter((s) => s.id === subscription.id);
        return qb;
      }
    });
  }

  async function build(p: ReturnType<typeof provider>['value']) {
    const module = await Test.createTestingModule({
      providers: [
        RenewalService,
        BillingAdminService,
        UsageService,
        UsageInvoicingService,
        CreditService,
        FixedRating,
        UsageRating,
        { provide: getDataSourceToken(), useValue: ds },
        {
          provide: getRepositoryToken(Customer),
          useValue: ds.getRepository(Customer)
        },
        {
          provide: getRepositoryToken(Subscription),
          useValue: scopedSubscriptions()
        },
        {
          provide: getRepositoryToken(Invoice),
          useValue: ds.getRepository(Invoice)
        },
        { provide: getRepositoryToken(Plan), useValue: ds.getRepository(Plan) },
        {
          provide: getRepositoryToken(UsageRecord),
          useValue: ds.getRepository(UsageRecord)
        },
        {
          provide: getRepositoryToken(WebhookEvent),
          useValue: ds.getRepository(WebhookEvent)
        },
        {
          provide: getRepositoryToken(CreditBalance),
          useValue: ds.getRepository(CreditBalance)
        },
        { provide: BILLING_PROVIDERS, useValue: [p] },
        { provide: BillingService, useValue: { getProviderById: () => p } },
        {
          provide: EntitlementService,
          useValue: { invalidateUser: jest.fn(() => Promise.resolve()) }
        },
        {
          provide: MetricsService,
          useValue: { recordUnratedUsage: jest.fn() }
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } }
      ]
    }).compile();
    return {
      renewals: module.get(RenewalService),
      admin: module.get(BillingAdminService),
      usage: module.get(UsageService),
      invoicing: module.get(UsageInvoicingService)
    };
  }

  function recordLate(usage: UsageService, occurredAt: Date) {
    return usage.record({
      customerId: subscription.customerId,
      meterKey: METER,
      quantity: 30,
      idempotencyKey: LATE_KEY,
      occurredAt
    });
  }

  /** True once an UPDATE whose text contains `marker` waits on a row lock. */
  async function updateBlockedOn(marker: string): Promise<boolean> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows: unknown[] = await ds.query(
        `SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query ILIKE 'UPDATE%'
            AND query LIKE $1`,
        [`%${marker}%`]
      );
      if (rows.length > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  async function lateRowStored(): Promise<boolean> {
    return ds
      .getRepository(UsageRecord)
      .exists({ where: { customerId, idempotencyKey: LATE_KEY } });
  }

  it('a renewal waits for an ingest that passed its check, and bills the record', async () => {
    const periodEnd = new Date(Date.now() - DAY_MS);
    await seed({
      provider: 'yookassa',
      periodStart: new Date(periodEnd.getTime() - 30 * DAY_MS),
      periodEnd
    });
    const p = provider('yookassa');
    p.charge.release();
    const { renewals, usage } = await build(p.value);

    insertGate = gate();
    const ingest = recordLate(usage, new Date(periodEnd.getTime() - 60_000));
    await insertGate.entered;
    const scan = renewals.runDueRenewals(new Date());
    const blocked = await updateBlockedOn('usage_sealed_until');
    insertGate.release();
    await ingest;
    await scan;

    expect(p.amounts).toEqual([WITH_LATE_MINOR]);
    expect(blocked).toBe(true);
  }, 30000);

  it('an ingest after a renewal sealed the window is refused, not stored', async () => {
    const periodEnd = new Date(Date.now() - DAY_MS);
    await seed({
      provider: 'yookassa',
      periodStart: new Date(periodEnd.getTime() - 30 * DAY_MS),
      periodEnd
    });
    const p = provider('yookassa');
    const { renewals, usage } = await build(p.value);

    const scan = renewals.runDueRenewals(new Date());
    await p.charge.entered;
    const refused = await recordLate(
      usage,
      new Date(periodEnd.getTime() - 60_000)
    ).catch((error: unknown) => error);
    p.charge.release();
    await scan;

    expect(refused).toBeInstanceOf(BadRequestException);
    expect((refused as BadRequestException).getResponse()).toMatchObject({
      errorKey: ErrorKeys.BILLING.USAGE_BEFORE_OPEN_WINDOW
    });
    expect(p.amounts).toEqual([WITHOUT_LATE_MINOR]);
    expect(await lateRowStored()).toBe(false);
  }, 30000);

  it('an immediate cancel waits for an ingest that passed its check, and bills the record', async () => {
    const now = Date.now();
    await seed({
      provider: 'yookassa',
      periodStart: new Date(now - 10 * DAY_MS),
      periodEnd: new Date(now + 20 * DAY_MS)
    });
    const p = provider('yookassa');
    p.charge.release();
    const { admin, usage } = await build(p.value);

    insertGate = gate();
    const ingest = recordLate(usage, new Date(now - 60_000));
    await insertGate.entered;
    const cancel = admin.cancelSubscription(subscription.id, 'immediate');
    const blocked = await updateBlockedOn('usage_sealed_until');
    insertGate.release();
    await ingest;
    const canceled = await cancel;

    expect(canceled.status).toBe('canceled');
    expect(p.amounts).toEqual([WITH_LATE_MINOR]);
    expect(blocked).toBe(true);
  }, 30000);

  it('a provider period close waits for an ingest that passed its check, and bills the record', async () => {
    const periodEnd = new Date(Date.now() - 60_000);
    const periodStart = new Date(periodEnd.getTime() - 30 * DAY_MS);
    await seed({ provider: 'paddle', periodStart, periodEnd });
    const p = provider('paddle');
    const { usage, invoicing } = await build(p.value);

    insertGate = gate();
    const ingest = recordLate(usage, new Date(periodEnd.getTime() - 60_000));
    await insertGate.entered;
    // The rollover write of the webhook reducer moves the stored window to the
    // next period, and the close event it emits then rates the old window.
    const close = ds
      .query(
        `UPDATE "subscriptions" /* window-race-rollover */
            SET "current_period_start" = $2, "current_period_end" = $3,
                "metered_from" = NULL
          WHERE "id" = $1`,
        [
          subscription.id,
          periodEnd,
          new Date(periodEnd.getTime() + 30 * DAY_MS)
        ]
      )
      .then(() =>
        invoicing.invoiceClosedPeriod(
          new UsagePeriodClosedEvent(
            String(userId),
            subscription.id,
            periodStart,
            periodEnd,
            PLAN_KEY
          )
        )
      );
    const blocked = await updateBlockedOn('window-race-rollover');
    insertGate.release();
    await ingest;
    await close;

    expect(p.amounts).toEqual([WITH_LATE_MINOR]);
    expect(blocked).toBe(true);
  }, 30000);
});
