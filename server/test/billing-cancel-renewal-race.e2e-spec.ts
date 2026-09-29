// An immediate cancel that lands while the renewal scan charges the same due
// usage period must charge under the renewal key, so that the invoice insert
// and the provider's idempotence key collapse the two charges into one.

import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
import { BILLING_PROVIDERS } from '../src/modules/billing/providers/payment-provider.interface';
import { FixedRating } from '../src/modules/billing/rating/fixed-rating.strategy';
import { UsageRating } from '../src/modules/billing/rating/usage-rating.strategy';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { BillingAdminService } from '../src/modules/billing/services/billing-admin.service';
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { EntitlementService } from '../src/modules/entitlements/entitlement.service';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const DAY_MS = 86_400_000;
const PLAN_KEY = 'cancel-race-usage';
const METER = 'cancel-race-calls';

runWithInfra(
  'Immediate cancel vs. the renewal of a due usage period (e2e)',
  () => {
    let ds: DataSource;
    let userId: string | undefined;
    let customerId: string | undefined;
    let subscription: Subscription;

    beforeAll(async () => {
      ds = new DataSource({ ...postgresConfig(), logging: false });
      await ds.initialize();
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
            }
          }
        })
      );
    }, 30000);

    beforeEach(async () => {
      await seed();
    });

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
     * A usage subscription due one day ago with 100 units in its period and a
     * balance of 50 prepaid credits, so the period rates to 50 billable units.
     */
    async function seed(): Promise<void> {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const user = await ds.getRepository(User).save(
        ds.getRepository(User).create({
          email: `cancel-race-${stamp}@example.com`,
          firstName: 'Cancel',
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

      const periodStart = new Date(Date.now() - 31 * DAY_MS);
      subscription = await ds.getRepository(Subscription).save(
        ds.getRepository(Subscription).create({
          customerId: customer.id,
          planKey: PLAN_KEY,
          provider: 'yookassa',
          billingMode: 'usage',
          status: 'active',
          lifecycleOwner: 'self',
          currentPeriodStart: periodStart,
          currentPeriodEnd: new Date(Date.now() - DAY_MS),
          billingAnchorAt: periodStart,
          cancelAtPeriodEnd: false,
          trialEnd: null,
          providerSubscriptionId: null,
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
          occurredAt: new Date(periodStart.getTime() + 60_000),
          idempotencyKey: `cancel-race-${stamp}`
        })
      );

      const purchase = await ds.getRepository(Invoice).save(
        ds.getRepository(Invoice).create({
          customerId: customer.id,
          subscriptionId: null,
          provider: 'yookassa',
          providerEventId: `cancel-race-credits-${stamp}`,
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

    /**
     * A provider whose first charge waits until `release` is called, so the
     * cancel can run while the renewal charge is in flight. Later charges answer
     * at once: holding them too would deadlock once both paths share a key.
     */
    function gatedProvider() {
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: () => void;
      const firstChargeEntered = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const keys: string[] = [];
      const provider = {
        id: 'yookassa' as const,
        managesLifecycle: false,
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
              await released;
            }
            return {
              providerInvoiceRef: `pay_${keys.length}`,
              status: 'captured'
            };
          }
        ),
        findOffSessionCharge: jest.fn(() => Promise.resolve(null)),
        getOffSessionCharge: jest.fn(() => Promise.resolve(null)),
        cancel: jest.fn(() => Promise.resolve(undefined))
      };
      return { provider, keys, release, firstChargeEntered };
    }

    /**
     * Other suites seed due subscriptions in the same database in parallel, so
     * the scan must see only the row this test owns.
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

    async function build(
      provider: ReturnType<typeof gatedProvider>['provider']
    ): Promise<{ renewals: RenewalService; admin: BillingAdminService }> {
      const events = { emit: jest.fn() };
      const module = await Test.createTestingModule({
        providers: [
          RenewalService,
          BillingAdminService,
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
          {
            provide: getRepositoryToken(Plan),
            useValue: ds.getRepository(Plan)
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
          { provide: BILLING_PROVIDERS, useValue: [provider] },
          {
            provide: BillingService,
            useValue: { getProviderById: () => provider }
          },
          {
            provide: EntitlementService,
            useValue: { invalidateUser: jest.fn(() => Promise.resolve()) }
          },
          { provide: EventEmitter2, useValue: events }
        ]
      }).compile();
      return {
        renewals: module.get(RenewalService),
        admin: module.get(BillingAdminService)
      };
    }

    it('charges the due period once and spends its credits once', async () => {
      const gate = gatedProvider();
      const { renewals, admin } = await build(gate.provider);
      const anchorMs = subscription.currentPeriodEnd.getTime();
      const renewalKey = `renewal:${subscription.id}:${anchorMs}`;

      const scan = renewals.runDueRenewals(new Date());
      await gate.firstChargeEntered;
      const canceled = await admin.cancelSubscription(
        subscription.id,
        'immediate'
      );
      gate.release();
      await scan;

      expect(canceled.status).toBe('canceled');
      expect(gate.keys).toEqual([renewalKey, renewalKey]);

      const invoices = await ds.getRepository(Invoice).find({
        where: { customerId, subscriptionId: subscription.id },
        order: { periodStart: 'ASC' }
      });
      const due = invoices.find((i) => i.providerEventId === renewalKey);
      expect(due).toMatchObject({ status: 'paid', creditUnitsApplied: 50 });
      expect(due?.amountMinor.toNumber()).toBe(50 * 200);
      expect(due?.periodEnd.getTime()).toBe(anchorMs);
      // Anything else on the books is the tail after the due moment, which
      // metered nothing here.
      for (const other of invoices.filter((i) => i !== due)) {
        expect(other.providerEventId).toBe(
          `cancel:${subscription.id}:${anchorMs}`
        );
        expect(other.amountMinor.toNumber()).toBe(0);
      }

      const balance = await ds
        .getRepository(CreditBalance)
        .findOneOrFail({ where: { customerId } });
      expect(balance.balanceUnits.toNumber()).toBe(0);
      const spends = await ds
        .getRepository(CreditLedger)
        .find({ where: { customerId, reason: 'usage' } });
      expect(spends.map((s) => s.delta.toNumber())).toEqual([-50]);
    }, 30000);
  }
);
