// A Paddle checkout opened from the browser with Paddle.js can carry any custom
// data, so a signed webhook proves only that Paddle sent it. These run the real
// PaddleProvider normalization and the real reducer against a real PostgreSQL,
// with custom data that names a dearer plan or pack than the price paid.

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { EventName } from '@paddle/paddle-node-sdk';
import { DataSource } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';
import { User } from '../src/modules/users/entities/user.entity';
import { CreditBalance } from '../src/modules/billing/entities/credit-balance.entity';
import { CreditLedger } from '../src/modules/billing/entities/credit-ledger.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Product } from '../src/modules/billing/entities/product.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { PADDLE_CLIENT } from '../src/modules/billing/providers/paddle.client';
import { PaddleProvider } from '../src/modules/billing/providers/paddle.provider';
import type { NormalizedEvent } from '../src/modules/billing/providers/payment-provider.interface';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const PRO = 'price-trust-pro';
const BUSINESS = 'price-trust-business';
const PACK_SMALL = 'price-trust-500';
const PACK_LARGE = 'price-trust-5000';

runWithInfra(
  'Paddle webhooks trust the paid price, not custom data (e2e)',
  () => {
    let ds: DataSource;
    let provider: PaddleProvider;
    let reducer: BillingEventReducer;
    let unmarshal: jest.Mock;
    let userId: string | undefined;
    let customerId: string;
    let packSmallId: string;
    let packLargeId: string;

    beforeAll(async () => {
      ds = new DataSource({ ...postgresConfig(), logging: false });
      await ds.initialize();
      const plans = ds.getRepository(Plan);
      await plans.save(
        [PRO, BUSINESS].map((key) =>
          plans.create({
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
              paddle: {
                currency: 'USD',
                amountMinor: key === PRO ? 1200 : 2900,
                providerPriceId: `pri_${key}`
              }
            }
          })
        )
      );
      const products = ds.getRepository(Product);
      const [small, large] = await products.save(
        [
          [PACK_SMALL, 500],
          [PACK_LARGE, 5000]
        ].map(([key, units]) =>
          products.create({
            key: key as string,
            name: key as string,
            description: null,
            type: 'credits',
            prices: {
              paddle: {
                currency: 'USD',
                amountMinor: units as number,
                paddlePriceId: `pri_${key}`
              }
            },
            grant: { credits: units as number },
            active: true
          })
        )
      );
      packSmallId = small.id;
      packLargeId = large.id;

      unmarshal = jest.fn();
      const module = await Test.createTestingModule({
        providers: [
          PaddleProvider,
          BillingEventReducer,
          CreditService,
          { provide: PADDLE_CLIENT, useValue: { webhooks: { unmarshal } } },
          { provide: ConfigService, useValue: { get: () => 'whsec_test' } },
          { provide: getDataSourceToken(), useValue: ds },
          {
            provide: getRepositoryToken(CreditBalance),
            useValue: ds.getRepository(CreditBalance)
          },
          {
            provide: MetricsService,
            useValue: { recordUnmatchedOffSessionCharge: jest.fn() }
          },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } }
        ]
      }).compile();
      provider = module.get(PaddleProvider);
      reducer = module.get(BillingEventReducer);
    }, 30000);

    beforeEach(async () => {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const user = await ds.getRepository(User).save(
        ds.getRepository(User).create({
          email: `price-trust-${stamp}@example.com`,
          firstName: 'Price',
          lastName: 'Trust',
          password: 'hashed'
        })
      );
      userId = user.id;
      const customer = await ds.getRepository(Customer).save(
        ds.getRepository(Customer).create({
          userId: user.id,
          provider: 'paddle',
          providerOverride: null,
          providerCustomerId: `ctm_${stamp}`,
          country: 'US',
          currency: 'USD',
          defaultPaymentMethodId: null
        })
      );
      customerId = customer.id;
    });

    afterEach(async () => {
      // The ledger and the invoices hold the customer under RESTRICT; the
      // customer, its balance and its subscription then cascade from the user.
      await ds.getRepository(CreditLedger).delete({ customerId });
      await ds.getRepository(Invoice).delete({ customerId });
      if (userId) {
        await ds.getRepository(User).delete({ id: userId });
        userId = undefined;
      }
    });

    afterAll(async () => {
      await ds?.getRepository(Plan).delete({ key: PRO });
      await ds?.getRepository(Plan).delete({ key: BUSINESS });
      await ds?.getRepository(Product).delete({ key: PACK_SMALL });
      await ds?.getRepository(Product).delete({ key: PACK_LARGE });
      await ds?.destroy();
    });

    async function deliver(eventType: EventName, data: object): Promise<void> {
      unmarshal.mockResolvedValueOnce({
        eventId: `evt_${Date.now()}_${Math.random()}`,
        eventType,
        data
      });
      const event = await provider.verifyAndParseWebhook(Buffer.from('{}'), {
        'paddle-signature': 'sig'
      });
      await reducer.reduce(event as NormalizedEvent);
    }

    it('stores the plan of the charged price when custom data names another plan', async () => {
      const providerSubscriptionId = `sub_${customerId}`;

      await deliver(EventName.SubscriptionCreated, {
        id: providerSubscriptionId,
        status: 'active',
        customData: { customerId, userId, planKey: BUSINESS },
        currentBillingPeriod: {
          startsAt: '2026-09-01T00:00:00Z',
          endsAt: '2026-10-01T00:00:00Z'
        },
        scheduledChange: null,
        items: [{ trialDates: null, price: { id: `pri_${PRO}` } }]
      });

      const stored = await ds
        .getRepository(Subscription)
        .findOneByOrFail({ providerSubscriptionId });
      expect(stored.planKey).toBe(PRO);
    });

    it('grants the pack of the paid price when custom data names a larger pack', async () => {
      await deliver(EventName.TransactionCompleted, {
        id: `txn_${customerId}`,
        status: 'completed',
        origin: 'web',
        subscriptionId: null,
        customData: {
          customerId,
          userId,
          kind: 'one_time',
          productId: packLargeId
        },
        currencyCode: 'USD',
        billingPeriod: null,
        billedAt: '2026-09-01T00:00:00Z',
        details: { totals: { total: '500' } },
        items: [{ price: { id: `pri_${PACK_SMALL}`, customData: null } }]
      });

      const balance = await ds
        .getRepository(CreditBalance)
        .findOneByOrFail({ customerId });
      expect(balance.balanceUnits.toNumber()).toBe(500);
      const invoice = await ds
        .getRepository(Invoice)
        .findOneByOrFail({ customerId });
      expect(invoice.productId).toBe(packSmallId);
    });
  }
);
