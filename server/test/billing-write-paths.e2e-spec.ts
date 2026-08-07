// Every billing write path against a real PostgreSQL. The rest of the billing
// suites mock the database, which is how a transformer writing NULL over
// `refunded_minor`'s NOT NULL DEFAULT broke every invoice insert unnoticed.
// These cases give a database-only defect somewhere to fail.

import { Test } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import { postgresConfig } from '../src/postgres.config';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { User } from '../src/modules/users/entities/user.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { CustomerGrant } from '../src/modules/billing/entities/customer-grant.entity';
import { CreditBalance } from '../src/modules/billing/entities/credit-balance.entity';
import { CreditLedger } from '../src/modules/billing/entities/credit-ledger.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Product } from '../src/modules/billing/entities/product.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { UsageRecord } from '../src/modules/billing/entities/usage-record.entity';
import { WebhookEvent } from '../src/modules/billing/entities/webhook-event.entity';
import { PaymentMethod } from '../src/modules/billing/entities/payment-method.entity';
import { BILLING_PROVIDERS } from '../src/modules/billing/providers/payment-provider.interface';
import { FixedRating } from '../src/modules/billing/rating/fixed-rating.strategy';
import { UsageRating } from '../src/modules/billing/rating/usage-rating.strategy';
import { BillingService } from '../src/modules/billing/billing.service';
import { EntitlementService } from '../src/modules/billing/entitlements/entitlement.service';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { UsageService } from '../src/modules/billing/services/usage.service';
import { UsageInvoicingService } from '../src/modules/billing/services/usage-invoicing.service';
import { BillingAdminService } from '../src/modules/billing/services/billing-admin.service';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import { WebhookIngestionService } from '../src/modules/billing/webhooks/webhook-ingestion.service';
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { UsagePeriodClosedEvent } from '../src/modules/billing/events/billing.events';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const DAY = 86_400_000;
const FIXED_PLAN = 'wp-fixed';
const USAGE_PLAN = 'wp-usage';
// A second metered plan, so the suite has a meter that is in the catalog but is
// not the meter of the subscription under test.
const ALT_USAGE_PLAN = 'wp-usage-alt';
const ALT_METER = 'wp-alt-meter';

runWithInfra('billing write paths (e2e)', () => {
  let ds: DataSource;
  let userId: string;
  let customerId: string;
  let subscriptionId: string;
  let provider: ReturnType<typeof makeProvider>;

  function makeProvider() {
    return {
      id: 'yookassa' as const,
      managesLifecycle: false,
      chargeOffSession: jest.fn(() =>
        Promise.resolve({ providerInvoiceRef: 'pay_wp', status: 'captured' })
      ),
      findOffSessionCharge: jest.fn(() => Promise.resolve(null)),
      chargeUsage: jest.fn(() => Promise.resolve(undefined)),
      refund: jest.fn(() => Promise.resolve(undefined)),
      cancel: jest.fn(() => Promise.resolve(undefined)),
      verifyAndParseWebhook: jest.fn(() => Promise.resolve(null))
    };
  }

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
    provider = makeProvider();
    await seedTenant();
  }, 60000);

  afterAll(async () => {
    await purge();
    await ds?.destroy();
  });

  /**
   * Invoices hold the customer under RESTRICT, so the financial rows go before
   * the user the rest of the graph cascades from.
   */
  async function purge(): Promise<void> {
    if (customerId) {
      await ds.getRepository(CustomerGrant).delete({ customerId });
      await ds.getRepository(CreditLedger).delete({ customerId });
      await ds.getRepository(CreditBalance).delete({ customerId });
      await ds.getRepository(UsageRecord).delete({ customerId });
      await ds.getRepository(Invoice).delete({ customerId });
    }
    if (userId) await ds.getRepository(User).delete({ id: userId });
    await ds
      .getRepository(WebhookEvent)
      .delete({ providerEventId: 'wp-webhook-1' });
    await ds
      .getRepository(Plan)
      .delete([
        { key: FIXED_PLAN },
        { key: USAGE_PLAN },
        { key: ALT_USAGE_PLAN }
      ]);
    await ds
      .getRepository(Product)
      .delete([{ key: 'wp-sku' }, { key: 'wp-credits' }]);
  }

  async function seedTenant(): Promise<void> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `billing-write-paths-${stamp}@example.com`,
        firstName: 'Write',
        lastName: 'Paths',
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

    await ds.getRepository(Plan).save([
      ds.getRepository(Plan).create({
        key: FIXED_PLAN,
        name: FIXED_PLAN,
        description: null,
        billingMode: 'fixed',
        interval: 'month',
        meterKey: null,
        entitlements: ['reports'],
        limits: null,
        trialDays: 0,
        active: true,
        prices: { yookassa: { currency: 'RUB', amountMinor: 99000 } }
      }),
      ds.getRepository(Plan).create({
        key: USAGE_PLAN,
        name: USAGE_PLAN,
        description: null,
        billingMode: 'usage',
        interval: 'month',
        meterKey: 'api_calls',
        entitlements: ['reports'],
        limits: null,
        trialDays: 0,
        active: true,
        prices: {
          yookassa: {
            currency: 'RUB',
            amountMinor: 0,
            unitPriceMinor: 200,
            includedUnits: 0
          }
        }
      }),
      ds.getRepository(Plan).create({
        key: ALT_USAGE_PLAN,
        name: ALT_USAGE_PLAN,
        description: null,
        billingMode: 'usage',
        interval: 'month',
        meterKey: ALT_METER,
        entitlements: [],
        limits: null,
        trialDays: 0,
        active: true,
        prices: {
          yookassa: {
            currency: 'RUB',
            amountMinor: 0,
            unitPriceMinor: 900,
            includedUnits: 0
          }
        }
      })
    ]);

    const method = await ds.getRepository(PaymentMethod).save(
      ds.getRepository(PaymentMethod).create({
        customerId: customer.id,
        provider: 'yookassa',
        providerMethodRef: 'tok_wp',
        brand: 'Visa',
        last4: '4242',
        isDefault: true
      })
    );
    await ds
      .getRepository(Customer)
      .update({ id: customer.id }, { defaultPaymentMethodId: method.id });

    const subscription = await ds.getRepository(Subscription).save(
      ds.getRepository(Subscription).create({
        customerId: customer.id,
        planKey: USAGE_PLAN,
        provider: 'yookassa',
        billingMode: 'usage',
        status: 'active',
        lifecycleOwner: 'self',
        currentPeriodStart: new Date(Date.now() - 40 * DAY),
        currentPeriodEnd: new Date(Date.now() - DAY),
        cancelAtPeriodEnd: false,
        trialEnd: null,
        providerSubscriptionId: null,
        paymentMethodId: method.id,
        version: 1,
        dunningAttempts: 0,
        nextRenewalAttemptAt: null
      })
    );
    subscriptionId = subscription.id;
  }

  /** Puts the shared subscription back on a known plan and lifecycle state. */
  function resetSubscription(
    planKey: string,
    overrides: Partial<Subscription> = {}
  ): Promise<unknown> {
    return ds.getRepository(Subscription).update(
      { id: subscriptionId },
      {
        planKey,
        billingMode: planKey === USAGE_PLAN ? 'usage' : 'fixed',
        status: 'active',
        dunningAttempts: 0,
        nextRenewalAttemptAt: null,
        currentPeriodStart: new Date(Date.now() - 40 * DAY),
        currentPeriodEnd: new Date(Date.now() - DAY),
        ...overrides
      }
    );
  }

  async function build<T>(
    type: new (...args: never[]) => T,
    extra: Provider[] = []
  ): Promise<T> {
    const module = await Test.createTestingModule({
      providers: [
        type,
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
          useValue: ds.getRepository(Subscription)
        },
        {
          provide: getRepositoryToken(Invoice),
          useValue: ds.getRepository(Invoice)
        },
        { provide: getRepositoryToken(Plan), useValue: ds.getRepository(Plan) },
        {
          provide: getRepositoryToken(Product),
          useValue: ds.getRepository(Product)
        },
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
        {
          provide: getRepositoryToken(PaymentMethod),
          useValue: ds.getRepository(PaymentMethod)
        },
        { provide: BILLING_PROVIDERS, useValue: [provider] },
        {
          provide: MetricsService,
          useValue: { recordUnratedUsage: jest.fn() }
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
            emitAsync: jest.fn(() => Promise.resolve([]))
          }
        },
        ...extra
      ]
    }).compile();
    return module.get(type);
  }

  function buildAdmin(): Promise<BillingAdminService> {
    return build(BillingAdminService, [
      {
        provide: BillingService,
        useValue: { getProviderById: () => provider }
      },
      {
        provide: EntitlementService,
        useValue: { invalidateUser: jest.fn(() => Promise.resolve()) }
      }
    ]);
  }

  async function seedProduct(
    key: string,
    type: 'sku' | 'credits',
    grant: Product['grant']
  ): Promise<Product> {
    await ds.getRepository(Product).save(
      ds.getRepository(Product).create({
        key,
        name: key,
        description: null,
        type,
        prices: { yookassa: { currency: 'RUB', amountMinor: 50000 } },
        grant,
        active: true
      })
    );
    return ds.getRepository(Product).findOneOrFail({ where: { key } });
  }

  async function reduceOneTime(
    eventId: string,
    productId: string
  ): Promise<void> {
    const reducer = await build(BillingEventReducer);
    await reducer.reduce({
      provider: 'yookassa',
      providerEventId: eventId,
      type: 'invoice.paid',
      occurredAt: new Date().toISOString(),
      payload: {
        kind: 'one_time',
        ref: { customerId },
        productId,
        providerInvoiceRef: `pay_${eventId}`,
        amountMinor: 50000,
        currency: 'RUB',
        paidAt: new Date().toISOString()
      }
      // The normalized-event shape is the provider seam's, not a DTO's.
    } as never);
  }

  function creditUnits(): Promise<number> {
    return ds
      .getRepository(CreditBalance)
      .findOne({ where: { customerId } })
      .then((b) => b?.balanceUnits.toNumber() ?? 0);
  }

  describe('metering and credits', () => {
    it('records a usage event', async () => {
      const usage = await build(UsageService);
      await usage.record({
        customerId,
        meterKey: 'api_calls',
        quantity: 5,
        occurredAt: new Date(Date.now() - 2 * DAY).toISOString(),
        idempotencyKey: 'wp-usage-1'
      });

      const rows = await ds
        .getRepository(UsageRecord)
        .find({ where: { customerId, idempotencyKey: 'wp-usage-1' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].quantity.toNumber()).toBe(5);
    }, 30000);

    it('refuses a meter no plan in the catalog declares', async () => {
      const usage = await build(UsageService);

      await expect(
        usage.record({
          customerId,
          meterKey: 'wp-unknown',
          quantity: 5,
          idempotencyKey: 'wp-usage-unknown'
        })
      ).rejects.toMatchObject({ status: 400 });

      const rows = await ds
        .getRepository(UsageRecord)
        .find({ where: { customerId, idempotencyKey: 'wp-usage-unknown' } });
      expect(rows).toHaveLength(0);
    }, 30000);

    it('rates only the plan meter when a foreign-meter row shares the period', async () => {
      // An isolated window, so only these two rows are in scope whatever else
      // the suite has recorded. Both go in through the real ingest: the foreign
      // one is another plan's meter, which is stored and simply not priced here.
      const period = {
        start: new Date('2020-01-01T00:00:00Z'),
        end: new Date('2020-02-01T00:00:00Z')
      };
      const occurredAt = new Date('2020-01-15T00:00:00Z');
      const usage = await build(UsageService);
      await usage.record({
        customerId,
        meterKey: 'api_calls',
        quantity: 7,
        occurredAt,
        idempotencyKey: 'wp-rate-own'
      });
      await usage.record({
        customerId,
        meterKey: ALT_METER,
        quantity: 1000,
        occurredAt,
        idempotencyKey: 'wp-rate-foreign'
      });
      const stored = await ds
        .getRepository(UsageRecord)
        .find({ where: { customerId, meterKey: ALT_METER } });
      expect(stored).toHaveLength(1);

      const rating = await build(UsageRating);
      const subscription = await ds
        .getRepository(Subscription)
        .findOneByOrFail({ id: subscriptionId });
      const plan = await ds
        .getRepository(Plan)
        .findOneByOrFail({ key: USAGE_PLAN });

      const summary = await rating.summarizeForPeriod(
        subscription,
        plan,
        period
      );

      expect(summary.totalUnits).toBe(7);
      expect(summary.amountMinor).toBe(1400);
    }, 30000);

    it('upserts the balance and appends a ledger row per delta', async () => {
      const invoice = await ds.getRepository(Invoice).save(
        ds.getRepository(Invoice).create({
          customerId,
          subscriptionId: null,
          provider: 'yookassa',
          providerEventId: 'wp-credit-src',
          providerInvoiceRef: 'pay_credit',
          amountMinor: Money.fromMinor(10000),
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
      const credits = await build(CreditService);

      await ds.transaction(async (m) => {
        await credits.addPurchase(m, customerId, invoice.id, 100);
        await credits.spendOnUsage(m, customerId, invoice.id, 30);
      });

      expect(await creditUnits()).toBe(70);
      expect(
        await ds.getRepository(CreditLedger).count({ where: { customerId } })
      ).toBe(2);
    }, 30000);
  });

  describe('webhook ingestion and reduction', () => {
    it('stores a verified delivery with its jsonb payload', async () => {
      provider.verifyAndParseWebhook.mockResolvedValueOnce({
        provider: 'yookassa',
        providerEventId: 'wp-webhook-1',
        type: 'invoice.paid',
        occurredAt: new Date().toISOString(),
        payload: { kind: 'subscription', amountMinor: 1000 }
      } as never);
      const ingestion = await build(WebhookIngestionService, [
        {
          provide: BillingEventReducer,
          useValue: { reduce: jest.fn(() => Promise.resolve()) }
        }
      ]);

      await ingestion.ingest('yookassa', Buffer.from('{"x":1}'), {});

      const row = await ds
        .getRepository(WebhookEvent)
        .findOne({ where: { providerEventId: 'wp-webhook-1' } });
      expect(row?.payload).toMatchObject({ type: 'invoice.paid' });
    }, 30000);

    it('inserts a subscription invoice, defaulting the columns it omits', async () => {
      const reducer = await build(BillingEventReducer);
      await reducer.reduce({
        provider: 'yookassa',
        providerEventId: 'wp-reduce-1',
        type: 'invoice.paid',
        occurredAt: new Date().toISOString(),
        payload: {
          kind: 'subscription',
          ref: { customerId },
          providerInvoiceRef: 'pay_reduced',
          amountMinor: 12345,
          currency: 'RUB',
          paidAt: new Date().toISOString(),
          periodStart: new Date().toISOString(),
          periodEnd: new Date(Date.now() + 30 * DAY).toISOString()
        }
      } as never);

      const row = await ds
        .getRepository(Invoice)
        .findOne({ where: { providerEventId: 'wp-reduce-1' } });
      expect(row?.amountMinor.toNumber()).toBe(12345);
      // Neither is in the insert's value set — both come from the column default.
      expect(row?.refundedMinor.toNumber()).toBe(0);
      expect(row?.kind).toBe('subscription');
    }, 30000);
  });

  describe('one-time purchases', () => {
    it('inserts the grant an sku product carries', async () => {
      const sku = await seedProduct('wp-sku', 'sku', {
        entitlement: 'reports',
        durationDays: 30
      });

      await reduceOneTime('wp-sku-1', sku.id);

      const invoice = await ds
        .getRepository(Invoice)
        .findOne({ where: { providerEventId: 'wp-sku-1' } });
      expect(invoice?.kind).toBe('one_time');
      const grants = await ds
        .getRepository(CustomerGrant)
        .find({ where: { customerId, entitlement: 'reports' } });
      expect(grants).toHaveLength(1);
      expect(grants[0].expiresAt).not.toBeNull();
    }, 30000);

    it('tops the balance up for a credits pack and writes no grant', async () => {
      const pack = await seedProduct('wp-credits', 'credits', { credits: 500 });
      const before = await creditUnits();
      const grantsBefore = await ds
        .getRepository(CustomerGrant)
        .count({ where: { customerId } });

      await reduceOneTime('wp-credits-1', pack.id);

      expect((await creditUnits()) - before).toBe(500);
      expect(
        await ds.getRepository(CustomerGrant).count({ where: { customerId } })
      ).toBe(grantsBefore);
    }, 30000);

    it('grants and credits exactly once when a delivery is replayed', async () => {
      const sku = await ds
        .getRepository(Product)
        .findOneOrFail({ where: { key: 'wp-sku' } });
      const pack = await ds
        .getRepository(Product)
        .findOneOrFail({ where: { key: 'wp-credits' } });
      const creditsBefore = await creditUnits();
      const grantsBefore = await ds
        .getRepository(CustomerGrant)
        .count({ where: { customerId } });

      await reduceOneTime('wp-replay-sku', sku.id);
      await reduceOneTime('wp-replay-sku', sku.id);
      await reduceOneTime('wp-replay-pack', pack.id);
      await reduceOneTime('wp-replay-pack', pack.id);

      expect(
        await ds
          .getRepository(Invoice)
          .count({ where: { providerEventId: 'wp-replay-sku' } })
      ).toBe(1);
      expect(
        await ds.getRepository(CustomerGrant).count({ where: { customerId } })
      ).toBe(grantsBefore + 1);
      expect((await creditUnits()) - creditsBefore).toBe(500);
    }, 30000);
  });

  describe('admin refunds', () => {
    it('flips the invoice to refunded and revokes the sku grant', async () => {
      const admin = await buildAdmin();
      const target = await ds
        .getRepository(Invoice)
        .findOneOrFail({ where: { providerEventId: 'wp-sku-1' } });

      const refunded = await admin.refundInvoice(target.id);

      expect(refunded.status).toBe('refunded');
      expect(refunded.refundedMinor.toNumber()).toBe(50000);
      const grants = await ds
        .getRepository(CustomerGrant)
        .find({ where: { customerId, sourceInvoiceId: target.id } });
      expect(grants).toHaveLength(1);
      expect(grants[0].revokedAt).not.toBeNull();
    }, 30000);

    it('claws the balance back when a credits pack is refunded', async () => {
      const admin = await buildAdmin();
      const before = await creditUnits();
      const target = await ds
        .getRepository(Invoice)
        .findOneOrFail({ where: { providerEventId: 'wp-credits-1' } });

      await admin.refundInvoice(target.id);

      expect(before - (await creditUnits())).toBe(500);
    }, 30000);
  });

  describe('renewals', () => {
    it('invoices a closed usage period', async () => {
      await resetSubscription(USAGE_PLAN);
      const invoicing = await build(UsageInvoicingService);
      const sub = await ds
        .getRepository(Subscription)
        .findOneOrFail({ where: { id: subscriptionId } });

      await invoicing.invoiceClosedPeriod(
        new UsagePeriodClosedEvent(
          userId,
          subscriptionId,
          sub.currentPeriodStart,
          sub.currentPeriodEnd
        )
      );

      const rows = await ds
        .getRepository(Invoice)
        .find({ where: { subscriptionId, billingMode: 'usage' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].refundedMinor.toNumber()).toBe(0);
    }, 30000);

    it('charges a due fixed subscription and advances the period', async () => {
      await resetSubscription(FIXED_PLAN);
      const renewals = await build(RenewalService);

      await renewals.runDueRenewals(new Date());

      const sub = await ds
        .getRepository(Subscription)
        .findOneOrFail({ where: { id: subscriptionId } });
      expect(sub.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
      expect(sub.status).toBe('active');
      const paid = await ds
        .getRepository(Invoice)
        .find({ where: { subscriptionId, status: 'paid' } });
      expect(paid.length).toBeGreaterThan(0);
    }, 60000);

    it('walks dunning when the card declines', async () => {
      await resetSubscription(FIXED_PLAN);
      provider.chargeOffSession.mockRejectedValueOnce(
        new Error('card declined')
      );
      const renewals = await build(RenewalService);

      await renewals.runDueRenewals(new Date());

      const sub = await ds
        .getRepository(Subscription)
        .findOneOrFail({ where: { id: subscriptionId } });
      expect(sub.status).toBe('past_due');
      expect(sub.dunningAttempts).toBe(1);
      expect(sub.nextRenewalAttemptAt).not.toBeNull();
    }, 60000);
  });
});
