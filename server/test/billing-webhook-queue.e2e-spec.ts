// The queued webhook path on a real Redis and a real PostgreSQL: ingestion adds
// a job, the BullMQ worker takes it after the Redis round trip and the real
// reducer writes the subscription. The other webhook suites build the
// ingestion service with no queue, so they run the inline branch only.

import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { EventName } from '@paddle/paddle-node-sdk';
import type { Queue } from 'bullmq';
import { DataSource, Like } from 'typeorm';
import { parseRedisConnection } from '../src/common/utils/parse-redis-connection';
import { postgresConfig } from '../src/postgres.config';
import { User } from '../src/modules/users/entities/user.entity';
import { CreditBalance } from '../src/modules/billing/entities/credit-balance.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { WebhookEvent } from '../src/modules/billing/entities/webhook-event.entity';
import { PADDLE_CLIENT } from '../src/modules/billing/providers/paddle.client';
import { PaddleProvider } from '../src/modules/billing/providers/paddle.provider';
import { BILLING_PROVIDERS } from '../src/modules/billing/providers/payment-provider.interface';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import { BillingWebhookProcessor } from '../src/modules/billing/webhooks/billing-webhook.processor';
import {
  BILLING_WEBHOOK_QUEUE,
  BILLING_WEBHOOK_RECONCILE_JOB,
  BILLING_WEBHOOK_RECONCILE_SCHEDULER_ID,
  BILLING_WEBHOOK_RETENTION_JOB,
  BILLING_WEBHOOK_RETENTION_SCHEDULER_ID,
  WEBHOOK_RECONCILE_INTERVAL_MS,
  WEBHOOK_RETENTION_INTERVAL_MS
} from '../src/modules/billing/webhooks/billing-webhook-queue.constants';
import { WebhookIngestionService } from '../src/modules/billing/webhooks/webhook-ingestion.service';
import { WebhookReconciliationService } from '../src/modules/billing/webhooks/webhook-reconciliation.service';
import { WebhookRetentionService } from '../src/modules/billing/webhooks/webhook-retention.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { eventually } from './eventually';

const REDIS_URL = process.env['REDIS_URL'];

// Skipped without Redis or PostgreSQL. CI runs it in the Redis-backed step.
const runWithRedis =
  REDIS_URL && process.env['DB_HOST'] ? describe : describe.skip;

const PLAN_KEY = 'webhook-queue-pro';
const PRICE_ID = `pri_${PLAN_KEY}`;
const EVENT_PREFIX = 'evt_webhook_queue_';
const PERIOD_START = '2026-09-01T00:00:00.000Z';
const PERIOD_END = '2026-10-01T00:00:00.000Z';
// The first retry of the reduce job waits 5 s (exponential backoff).
const RETRY_WAIT_MS = 20_000;

runWithRedis('billing webhook queue (real Redis)', () => {
  let ds: DataSource;
  let module: TestingModule;
  let ingestion: WebhookIngestionService;
  let reducer: BillingEventReducer;
  let queue: Queue;
  let unmarshal: jest.Mock;
  let userId: string | undefined;
  let customerId: string;

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
    const plans = ds.getRepository(Plan);
    await plans.save(
      plans.create({
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
          paddle: {
            currency: 'USD',
            amountMinor: 1200,
            providerPriceId: PRICE_ID
          }
        }
      })
    );

    unmarshal = jest.fn();
    module = await Test.createTestingModule({
      imports: [
        BullModule.forRoot({
          connection: parseRedisConnection(REDIS_URL as string)
        }),
        // A prefix of its own keeps the workers of other e2e apps, which
        // listen on the same queue name, away from the jobs of this suite.
        BullModule.registerQueue({
          name: BILLING_WEBHOOK_QUEUE,
          prefix: `e2e-webhook-queue-${Date.now()}`
        })
      ],
      providers: [
        WebhookIngestionService,
        BillingWebhookProcessor,
        BillingEventReducer,
        CreditService,
        PaddleProvider,
        {
          provide: BILLING_PROVIDERS,
          useFactory: (paddle: PaddleProvider) => [paddle],
          inject: [PaddleProvider]
        },
        { provide: PADDLE_CLIENT, useValue: { webhooks: { unmarshal } } },
        { provide: ConfigService, useValue: { get: () => 'whsec_test' } },
        { provide: getDataSourceToken(), useValue: ds },
        {
          provide: getRepositoryToken(WebhookEvent),
          useValue: ds.getRepository(WebhookEvent)
        },
        {
          provide: getRepositoryToken(CreditBalance),
          useValue: ds.getRepository(CreditBalance)
        },
        {
          provide: MetricsService,
          useValue: { recordUnmatchedOffSessionCharge: jest.fn() }
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        // The sweeps run on the real ledger, which other suites share.
        {
          provide: WebhookReconciliationService,
          useValue: { sweep: jest.fn() }
        },
        { provide: WebhookRetentionService, useValue: { sweep: jest.fn() } }
      ]
    }).compile();
    await module.init();

    ingestion = module.get(WebhookIngestionService);
    reducer = module.get(BillingEventReducer);
    queue = module.get(getQueueToken(BILLING_WEBHOOK_QUEUE));
  }, 60000);

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `webhook-queue-${stamp}@example.com`,
        name: 'Webhook Queue',
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
    jest.restoreAllMocks();
    await ds
      .getRepository(WebhookEvent)
      .delete({ providerEventId: Like(`${EVENT_PREFIX}%`) });
    // The customer and its subscription cascade from the user.
    if (userId) {
      await ds.getRepository(User).delete({ id: userId });
      userId = undefined;
    }
  });

  afterAll(async () => {
    await queue?.obliterate({ force: true });
    await module?.close();
    await ds?.getRepository(Plan).delete({ key: PLAN_KEY });
    await ds?.destroy();
  });

  async function deliverActivation(): Promise<string> {
    const providerEventId = `${EVENT_PREFIX}${customerId}`;
    unmarshal.mockResolvedValueOnce({
      eventId: providerEventId,
      eventType: EventName.SubscriptionCreated,
      data: {
        id: `sub_${customerId}`,
        status: 'active',
        customData: { customerId, userId },
        currentBillingPeriod: { startsAt: PERIOD_START, endsAt: PERIOD_END },
        scheduledChange: null,
        items: [{ trialDates: null, price: { id: PRICE_ID } }]
      }
    });
    await ingestion.ingest('paddle', Buffer.from('{}'), {
      'paddle-signature': 'sig'
    });
    return providerEventId;
  }

  function settledStatus(
    providerEventId: string,
    timeoutMs: number
  ): Promise<string | null> {
    return eventually(async () => {
      const row = await ds
        .getRepository(WebhookEvent)
        .findOneBy({ provider: 'paddle', providerEventId });
      return row?.status === 'processed' ? row.status : null;
    }, timeoutMs);
  }

  it('reduces a queued event onto the subscription through the worker', async () => {
    const reduce = jest.spyOn(reducer, 'reduce');

    const providerEventId = await deliverActivation();

    expect(await settledStatus(providerEventId, 10_000)).toBe('processed');
    expect(reduce).toHaveBeenCalledTimes(1);
    const stored = await ds
      .getRepository(Subscription)
      .findOneByOrFail({ providerSubscriptionId: `sub_${customerId}` });
    expect(stored).toMatchObject({
      customerId,
      planKey: PLAN_KEY,
      status: 'active',
      lifecycleOwner: 'provider'
    });
    // The period reached the reducer inside the JSON job payload in Redis.
    expect(stored.currentPeriodStart.toISOString()).toBe(PERIOD_START);
    expect(stored.currentPeriodEnd.toISOString()).toBe(PERIOD_END);
  });

  it('retries a failed reduction and then settles the delivery', async () => {
    const reduce = jest
      .spyOn(reducer, 'reduce')
      .mockRejectedValueOnce(new Error('transient database error'));

    const providerEventId = await deliverActivation();

    expect(await settledStatus(providerEventId, RETRY_WAIT_MS)).toBe(
      'processed'
    );
    expect(reduce).toHaveBeenCalledTimes(2);
    await expect(
      ds
        .getRepository(Subscription)
        .findOneByOrFail({ providerSubscriptionId: `sub_${customerId}` })
    ).resolves.toMatchObject({ status: 'active' });
  }, 30000);

  it('creates the reconcile and retention schedulers on bootstrap', async () => {
    const processor = module.get(BillingWebhookProcessor);
    // The bootstrap returns at once under NODE_ENV=test; this case is the one
    // place where its upserts run.
    const nodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'e2e-scheduler';
    try {
      await processor.onApplicationBootstrap();
    } finally {
      process.env['NODE_ENV'] = nodeEnv;
    }

    const reconcile = await queue.getJobScheduler(
      BILLING_WEBHOOK_RECONCILE_SCHEDULER_ID
    );
    const retention = await queue.getJobScheduler(
      BILLING_WEBHOOK_RETENTION_SCHEDULER_ID
    );
    expect(reconcile).toMatchObject({
      name: BILLING_WEBHOOK_RECONCILE_JOB,
      every: WEBHOOK_RECONCILE_INTERVAL_MS
    });
    expect(retention).toMatchObject({
      name: BILLING_WEBHOOK_RETENTION_JOB,
      every: WEBHOOK_RETENTION_INTERVAL_MS
    });
  });
});
