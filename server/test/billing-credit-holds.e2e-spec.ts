// Credits are spent only when an invoice becomes `paid`. Until a final outcome
// an unpaid invoice holds its `creditUnitsApplied`, and every rating subtracts
// the open holds under the balance row lock.

import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { BillingProviderId } from '@app/shared/types';
import { Money } from '@app/shared/utils/money';
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
import {
  InvoicePaidEvent,
  UsagePeriodClosedEvent
} from '../src/modules/billing/events/billing.events';
import {
  BILLING_PROVIDERS,
  ChargeDeclinedError,
  type ChargeResult
} from '../src/modules/billing/providers/payment-provider.interface';
import { FixedRating } from '../src/modules/billing/rating/fixed-rating.strategy';
import { UsageRating } from '../src/modules/billing/rating/usage-rating.strategy';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { BillingAdminService } from '../src/modules/billing/services/billing-admin.service';
import { UsageInvoicingService } from '../src/modules/billing/services/usage-invoicing.service';
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { EntitlementService } from '../src/modules/entitlements/entitlement.service';
import {
  BILLING_DB_LOCK_TIMEOUT_MS,
  holdBillingDbLock
} from './billing-db-lock';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const DAY_MS = 86_400_000;
const PLAN_KEY = 'credit-holds-usage';
const METER = 'credit-holds-calls';
const CREDITS = 50;
const UNIT_PRICE = 200;

type ChargeAnswer = () => Promise<ChargeResult>;

runWithInfra('Credit holds of unpaid invoices (e2e)', () => {
  let ds: DataSource;
  let releaseDbLock: (() => Promise<void>) | undefined;
  let userId: string | undefined;
  let customerId: string;
  let subscription: Subscription;

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
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
            unitPriceMinor: UNIT_PRICE,
            includedUnits: 0
          },
          paddle: {
            currency: 'USD',
            amountMinor: 0,
            unitPriceMinor: UNIT_PRICE,
            includedUnits: 0
          }
        }
      })
    );
  }, BILLING_DB_LOCK_TIMEOUT_MS);

  afterEach(async () => {
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

  /**
   * A usage subscription due one day ago, 100 units inside the due period, 100
   * units after the due moment, and 50 prepaid credits.
   */
  async function seed(provider: BillingProviderId): Promise<void> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `credit-holds-${stamp}@example.com`,
        name: 'Credit Holds',
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

    const periodStart = new Date(Date.now() - 31 * DAY_MS);
    const anchor = new Date(Date.now() - DAY_MS);
    subscription = await ds.getRepository(Subscription).save(
      ds.getRepository(Subscription).create({
        customerId: customer.id,
        planKey: PLAN_KEY,
        provider,
        billingMode: 'usage',
        status: 'active',
        lifecycleOwner: provider === 'yookassa' ? 'self' : 'provider',
        currentPeriodStart: periodStart,
        currentPeriodEnd: anchor,
        billingAnchorAt: provider === 'yookassa' ? periodStart : null,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        providerSubscriptionId:
          provider === 'yookassa' ? null : `psub_${stamp}`,
        paymentMethodId: null,
        version: 1,
        dunningAttempts: 0,
        nextRenewalAttemptAt: null
      })
    );

    for (const [at, suffix] of [
      [new Date(periodStart.getTime() + 60_000), 'due'],
      [new Date(anchor.getTime() + 60_000), 'tail']
    ] as const) {
      await ds.getRepository(UsageRecord).save(
        ds.getRepository(UsageRecord).create({
          customerId: customer.id,
          subscriptionId: subscription.id,
          meterKey: METER,
          quantity: Money.fromMinor(100),
          occurredAt: at,
          idempotencyKey: `credit-holds-${suffix}-${stamp}`
        })
      );
    }

    const purchase = await ds.getRepository(Invoice).save(
      ds.getRepository(Invoice).create({
        customerId: customer.id,
        subscriptionId: null,
        provider,
        providerEventId: `credit-holds-credits-${stamp}`,
        providerInvoiceRef: 'pay_credits',
        amountMinor: Money.fromMinor(5000),
        currency: provider === 'yookassa' ? 'RUB' : 'USD',
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
        CREDITS
      )
    );
  }

  /**
   * A provider whose charges answer in turn from `answers`, recording the key
   * of each. `held` makes the first charge wait until `release` is called.
   */
  function fakeProvider(id: BillingProviderId, answers: ChargeAnswer[]) {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const firstChargeEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const keys: string[] = [];
    const state = { held: false };
    const provider = {
      id,
      managesLifecycle: id === 'paddle',
      chargeOffSession: jest.fn(
        async (
          _customer: Customer,
          _amountMinor: number,
          _currency: string,
          _items: unknown,
          key: string
        ) => {
          keys.push(key);
          if (keys.length === 1) {
            entered();
            if (state.held) await released;
          }
          const answer = answers[keys.length - 1];
          return answer
            ? answer()
            : { providerInvoiceRef: `pay_${keys.length}`, status: 'captured' };
        }
      ),
      chargeUsage: jest.fn(() => Promise.resolve(undefined)),
      findOffSessionCharge: jest.fn(() => Promise.resolve(null)),
      getOffSessionCharge: jest.fn(() => Promise.resolve(null)),
      cancel: jest.fn(() => Promise.resolve(undefined))
    };
    return { provider, keys, state, release, firstChargeEntered };
  }

  /** The renewal scan must see only the row this test owns. */
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

  async function build(provider: ReturnType<typeof fakeProvider>['provider']) {
    const events = { emit: jest.fn() };
    const repo = <T extends object>(entity: new () => T) => ({
      provide: getRepositoryToken(entity),
      useValue: ds.getRepository(entity)
    });
    const module = await Test.createTestingModule({
      providers: [
        RenewalService,
        BillingAdminService,
        UsageInvoicingService,
        BillingEventReducer,
        CreditService,
        FixedRating,
        UsageRating,
        { provide: getDataSourceToken(), useValue: ds },
        repo(Customer),
        repo(Invoice),
        repo(Plan),
        repo(UsageRecord),
        repo(WebhookEvent),
        repo(CreditBalance),
        {
          provide: getRepositoryToken(Subscription),
          useValue: scopedSubscriptions()
        },
        { provide: BILLING_PROVIDERS, useValue: [provider] },
        {
          provide: BillingService,
          useValue: { getProviderById: () => provider }
        },
        {
          provide: EntitlementService,
          useValue: { invalidateUser: jest.fn(() => Promise.resolve()) }
        },
        {
          provide: MetricsService,
          useValue: { recordUnmatchedOffSessionCharge: jest.fn() }
        },
        { provide: EventEmitter2, useValue: events }
      ]
    }).compile();
    return {
      renewals: module.get(RenewalService),
      admin: module.get(BillingAdminService),
      usage: module.get(UsageInvoicingService),
      reducer: module.get(BillingEventReducer),
      credits: module.get(CreditService),
      events
    };
  }

  async function balance(): Promise<number> {
    const row = await ds
      .getRepository(CreditBalance)
      .findOneOrFail({ where: { customerId } });
    return row.balanceUnits.toNumber();
  }

  async function usageSpends(): Promise<number[]> {
    const rows = await ds
      .getRepository(CreditLedger)
      .find({ where: { customerId, reason: 'usage' } });
    return rows.map((r) => r.delta.toNumber());
  }

  function available(credits: CreditService): Promise<number> {
    return ds.transaction((m) =>
      credits.availableUnitsForUpdate(m, customerId)
    );
  }

  function invoiceOf(key: string): Promise<Invoice> {
    return ds
      .getRepository(Invoice)
      .findOneOrFail({ where: { providerEventId: key } });
  }

  function paid(chargeKey: string, ref: string, amountMinor: number) {
    return {
      provider: 'yookassa' as const,
      providerEventId: `evt_${ref}`,
      type: 'invoice.paid' as const,
      payload: {
        ref: { customerId },
        providerInvoiceRef: ref,
        providerSubscriptionId: null,
        amountMinor,
        currency: 'RUB',
        periodStart: null,
        periodEnd: null,
        paidAt: new Date().toISOString(),
        offSessionChargeKey: chargeKey
      }
    };
  }

  describe('YooKassa', () => {
    beforeEach(() => seed('yookassa'));

    it('spends the units of a pending renewal once when an immediate cancel bills the tail', async () => {
      const fake = fakeProvider('yookassa', [
        () =>
          Promise.resolve({ providerInvoiceRef: 'pay_ren', status: 'pending' })
      ]);
      const { renewals, admin, reducer, credits } = await build(fake.provider);
      const anchorMs = subscription.currentPeriodEnd.getTime();
      const renewalKey = `renewal:${subscription.id}:${anchorMs}`;
      const tailKey = `cancel:${subscription.id}:${anchorMs}`;

      await renewals.runDueRenewals(new Date());
      expect(await invoiceOf(renewalKey)).toMatchObject({
        status: 'pending',
        creditUnitsApplied: CREDITS
      });
      expect(await available(credits)).toBe(0);

      await admin.cancelSubscription(subscription.id, 'immediate');
      const tail = await invoiceOf(tailKey);
      expect(tail).toMatchObject({ status: 'paid', creditUnitsApplied: 0 });
      expect(tail.amountMinor.toNumber()).toBe(100 * UNIT_PRICE);

      await reducer.reduce(paid(renewalKey, 'pay_ren', 50 * UNIT_PRICE));

      expect(await invoiceOf(renewalKey)).toMatchObject({ status: 'paid' });
      expect(await balance()).toBe(0);
      expect(await usageSpends()).toEqual([-CREDITS]);
    }, 30000);

    it('rates a cancel that runs during the renewal charge against the units that charge holds', async () => {
      const fake = fakeProvider('yookassa', []);
      fake.state.held = true;
      const { renewals, admin } = await build(fake.provider);
      const anchorMs = subscription.currentPeriodEnd.getTime();
      const renewalKey = `renewal:${subscription.id}:${anchorMs}`;
      const tailKey = `cancel:${subscription.id}:${anchorMs}`;

      const scan = renewals.runDueRenewals(new Date());
      await fake.firstChargeEntered;
      await admin.cancelSubscription(subscription.id, 'immediate');
      fake.release();
      await scan;

      expect(fake.keys).toEqual([renewalKey, tailKey]);
      expect(await invoiceOf(renewalKey)).toMatchObject({
        status: 'paid',
        creditUnitsApplied: CREDITS
      });
      const tail = await invoiceOf(tailKey);
      expect(tail).toMatchObject({ status: 'paid', creditUnitsApplied: 0 });
      expect(tail.amountMinor.toNumber()).toBe(100 * UNIT_PRICE);
      expect(await balance()).toBe(0);
      expect(await usageSpends()).toEqual([-CREDITS]);
    }, 30000);

    it.each([
      ['a decline releases', () => new ChargeDeclinedError(), CREDITS],
      ['a timeout keeps', () => new Error('deadline'), 0]
    ])(
      '%s the hold of the renewal at once',
      async (_name, error, availableAfter) => {
        const fake = fakeProvider('yookassa', [() => Promise.reject(error())]);
        const { renewals, credits } = await build(fake.provider);
        const renewalKey = `renewal:${subscription.id}:${subscription.currentPeriodEnd.getTime()}`;

        await renewals.runDueRenewals(new Date());

        expect(await invoiceOf(renewalKey)).toMatchObject({
          status: 'failed',
          creditUnitsApplied: CREDITS
        });
        expect(await available(credits)).toBe(availableAfter);
        expect(await usageSpends()).toEqual([]);
      },
      30000
    );

    it('settles a closing charge booked failed when the money arrives later', async () => {
      const fake = fakeProvider('yookassa', [
        () => Promise.reject(new Error('deadline'))
      ]);
      // Not yet due: the immediate cancel bills the open window under a cancel key.
      await ds
        .getRepository(Subscription)
        .update(
          { id: subscription.id },
          { currentPeriodEnd: new Date(Date.now() + DAY_MS) }
        );
      const { admin, reducer, events } = await build(fake.provider);
      const closingKey = `cancel:${subscription.id}:${subscription.currentPeriodStart.getTime()}`;

      await admin.cancelSubscription(subscription.id, 'immediate');
      const booked = await invoiceOf(closingKey);
      expect(booked).toMatchObject({
        status: 'failed',
        creditUnitsApplied: CREDITS
      });
      // The cancel ended the hold; the late payment still spends the units.
      expect(booked.creditsReleasedAt).not.toBeNull();

      await reducer.reduce(
        paid(closingKey, 'pay_late', booked.amountMinor.toNumber())
      );

      expect(await invoiceOf(closingKey)).toMatchObject({
        status: 'paid',
        providerInvoiceRef: 'pay_late'
      });
      expect(await usageSpends()).toEqual([-CREDITS]);
      expect(
        events.emit.mock.calls.filter(
          (call: unknown[]) => call[0] === InvoicePaidEvent.name
        )
      ).toHaveLength(1);
    }, 30000);
  });

  describe('Paddle', () => {
    beforeEach(() => seed('paddle'));

    function closeEvent(): UsagePeriodClosedEvent {
      return new UsagePeriodClosedEvent(
        userId!,
        subscription.id,
        subscription.currentPeriodStart,
        subscription.currentPeriodEnd,
        PLAN_KEY
      );
    }

    function usageKey(): string {
      return `usage:${subscription.id}:${subscription.currentPeriodEnd.getTime()}`;
    }

    it('holds the units of a pending usage charge through a failure and spends them on a later payment', async () => {
      const fake = fakeProvider('paddle', []);
      const { usage, reducer, credits } = await build(fake.provider);

      await usage.invoiceClosedPeriod(closeEvent());
      expect(await invoiceOf(usageKey())).toMatchObject({
        status: 'pending',
        creditUnitsApplied: CREDITS
      });
      expect(await balance()).toBe(CREDITS);
      expect(await available(credits)).toBe(0);

      await reducer.reduce({
        provider: 'paddle',
        providerEventId: 'evt_failed',
        type: 'payment.failed',
        payload: {
          ref: { customerId },
          providerSubscriptionId: subscription.providerSubscriptionId,
          usageChargeKey: usageKey()
        }
      });
      expect(await invoiceOf(usageKey())).toMatchObject({ status: 'failed' });
      expect(await available(credits)).toBe(0);

      await reducer.reduce({
        provider: 'paddle',
        providerEventId: 'evt_paid',
        type: 'invoice.paid',
        payload: {
          ref: { customerId },
          providerInvoiceRef: 'txn_retry',
          providerSubscriptionId: subscription.providerSubscriptionId,
          amountMinor: 50 * UNIT_PRICE,
          currency: 'USD',
          periodStart: null,
          periodEnd: null,
          paidAt: new Date().toISOString(),
          usageChargeKey: usageKey()
        }
      });

      expect(await invoiceOf(usageKey())).toMatchObject({ status: 'paid' });
      expect(await balance()).toBe(0);
      expect(await usageSpends()).toEqual([-CREDITS]);
    }, 30000);

    it('releases the hold when the provider cancels the subscription', async () => {
      const fake = fakeProvider('paddle', []);
      const { usage, reducer, credits } = await build(fake.provider);

      await usage.invoiceClosedPeriod(closeEvent());
      expect(await available(credits)).toBe(0);

      await reducer.reduce({
        provider: 'paddle',
        providerEventId: 'evt_canceled',
        type: 'subscription.canceled',
        payload: {
          ref: { customerId },
          providerSubscriptionId: subscription.providerSubscriptionId,
          status: 'canceled',
          providerPriceIds: [],
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          trialEnd: null
        }
      });

      expect(await available(credits)).toBe(CREDITS);
      expect(await usageSpends()).toEqual([]);
    }, 30000);
  });
});
