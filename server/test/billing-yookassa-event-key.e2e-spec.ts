// A YooKassa notification has no signature, so a buyer who knows a payment id
// can post a second one with another event name for the same paid payment.

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { openAdminDataSource } from './admin-data-source';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { User } from '../src/modules/users/entities/user.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { CreditBalance } from '../src/modules/billing/entities/credit-balance.entity';
import { CreditLedger } from '../src/modules/billing/entities/credit-ledger.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { PaymentMethod } from '../src/modules/billing/entities/payment-method.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Product } from '../src/modules/billing/entities/product.entity';
import { WebhookEvent } from '../src/modules/billing/entities/webhook-event.entity';
import { BILLING_PROVIDERS } from '../src/modules/billing/providers/payment-provider.interface';
import { YOOKASSA_CLIENT } from '../src/modules/billing/providers/yookassa.client';
import { YooKassaProvider } from '../src/modules/billing/providers/yookassa.provider';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import { WebhookIngestionService } from '../src/modules/billing/webhooks/webhook-ingestion.service';
import {
  BILLING_DB_LOCK_TIMEOUT_MS,
  holdBillingDbLock
} from './billing-db-lock';
import { repositoryProviders } from './repository-providers';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const PACK = 'event-key-pack';

runWithInfra('YooKassa webhook dedup key (e2e)', () => {
  let ds: DataSource;
  let settingsDs: DataSource;
  let releaseDbLock: (() => Promise<void>) | undefined;
  let ingestion: WebhookIngestionService;
  let getPayment: jest.Mock;
  let userId: string;
  let customerId: string;
  let productId: string;
  let paymentId: string;

  beforeAll(async () => {
    ds = await openAdminDataSource('regional');
    settingsDs = await openAdminDataSource('settings');
    releaseDbLock = await holdBillingDbLock(ds);

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    paymentId = `pay-event-key-${stamp}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `event-key-${stamp}@example.com`,
        name: 'Event Key',
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
    await settingsDs.getRepository(Product).save(
      settingsDs.getRepository(Product).create({
        key: PACK,
        name: PACK,
        description: null,
        type: 'credits',
        prices: { yookassa: { currency: 'RUB', amountMinor: 50000 } },
        grant: { credits: 500 },
        active: true
      })
    );
    ({ id: productId } = await settingsDs
      .getRepository(Product)
      .findOneOrFail({ where: { key: PACK } }));

    getPayment = jest.fn(() =>
      Promise.resolve({
        id: paymentId,
        status: 'succeeded',
        amount: { value: '500.00', currency: 'RUB' },
        captured_at: new Date().toISOString(),
        metadata: { customerId, userId, purpose: 'one_time', productId }
      })
    );

    const module = await Test.createTestingModule({
      providers: [
        WebhookIngestionService,
        BillingEventReducer,
        CreditService,
        YooKassaProvider,
        { provide: YOOKASSA_CLIENT, useValue: { getPayment } },
        { provide: ConfigService, useValue: { get: () => '1' } },
        { provide: getDataSourceToken(), useValue: ds },
        ...repositoryProviders({ regional: ds, settings: settingsDs }, [
          User,
          PaymentMethod,
          WebhookEvent,
          CreditBalance,
          Plan,
          Product
        ]),
        {
          provide: BILLING_PROVIDERS,
          useFactory: (p: YooKassaProvider) => [p],
          inject: [YooKassaProvider]
        },
        {
          provide: MetricsService,
          useValue: { recordUnmatchedOffSessionCharge: jest.fn() }
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
            emitAsync: jest.fn(() => Promise.resolve([]))
          }
        }
      ]
    }).compile();

    ingestion = module.get(WebhookIngestionService);
  }, BILLING_DB_LOCK_TIMEOUT_MS);

  afterAll(async () => {
    if (customerId) {
      await ds.getRepository(CreditLedger).delete({ customerId });
      await ds.getRepository(CreditBalance).delete({ customerId });
      await ds.getRepository(Invoice).delete({ customerId });
    }

    if (paymentId) {
      await ds
        .getRepository(WebhookEvent)
        .delete({ providerEventId: `payment.succeeded:${paymentId}` });
      await ds
        .getRepository(WebhookEvent)
        .delete({ providerEventId: `payment.canceled:${paymentId}` });
    }

    if (userId) await ds.getRepository(User).delete({ id: userId });

    await settingsDs?.getRepository(Product).delete({ key: PACK });
    await releaseDbLock?.();
    await settingsDs?.destroy();
    await ds?.destroy();
  });

  function notify(event: string): Promise<unknown> {
    return ingestion.ingest(
      'yookassa',
      Buffer.from(
        JSON.stringify({
          type: 'notification',
          event,
          object: { id: paymentId }
        })
      ),
      {}
    );
  }

  it('records and credits a succeeded payment once when a forged canceled notification follows', async () => {
    await notify('payment.succeeded');
    await notify('payment.canceled');

    const invoices = await ds
      .getRepository(Invoice)
      .find({ where: { customerId } });

    expect(invoices.map((i) => [i.providerInvoiceRef, i.status])).toEqual([
      [paymentId, 'paid']
    ]);
    const balance = await ds
      .getRepository(CreditBalance)
      .findOneOrFail({ where: { customerId } });

    expect(balance.balanceUnits.toNumber()).toBe(500);
    expect(
      await ds.getRepository(CreditLedger).count({ where: { customerId } })
    ).toBe(1);
    expect(getPayment).toHaveBeenCalledTimes(2);
  }, 30000);
});
