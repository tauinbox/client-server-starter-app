// An admin replay, a provider redelivery and a failed sweep replay each decide
// from the status or the attempts of a webhook row and then write it. These
// cases run the real repository against a real PostgreSQL and hold each read
// at a gate, so the interleaving that production allows is deterministic.

import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, In, type Repository } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { expectApiError } from '../src/common/testing/api-error.expect';
import { postgresConfig } from '../src/postgres.config';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { WebhookEvent } from '../src/modules/billing/entities/webhook-event.entity';
import { BillingService } from '../src/modules/billing/billing.service';
import { BillingAdminService } from '../src/modules/billing/services/billing-admin.service';
import { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { BILLING_PROVIDERS } from '../src/modules/billing/providers/payment-provider.interface';
import type { NormalizedEvent } from '../src/modules/billing/providers/payment-provider.interface';
import { BillingEventReducer } from '../src/modules/billing/webhooks/billing-event-reducer.service';
import { WebhookIngestionService } from '../src/modules/billing/webhooks/webhook-ingestion.service';
import { WebhookReconciliationService } from '../src/modules/billing/webhooks/webhook-reconciliation.service';
import {
  WEBHOOK_MAX_REPLAY_ATTEMPTS,
  WEBHOOK_RECEIVED_STUCK_THRESHOLD_MS
} from '../src/modules/billing/webhooks/billing-webhook-queue.constants';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

/** Resolves each waiter once `size` callers wait, so all reads land first. */
function barrier(size: number): () => Promise<void> {
  let waiting = 0;
  const { promise: opened, resolve: open } = Promise.withResolvers<void>();

  return () => {
    waiting += 1;

    if (waiting === size) open();

    return opened;
  };
}

runWithInfra('Webhook status writes vs. a concurrent writer (e2e)', () => {
  let ds: DataSource;
  let repo: Repository<WebhookEvent>;
  const seeded: string[] = [];

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
    repo = ds.getRepository(WebhookEvent);
  }, 30000);

  afterEach(async () => {
    jest.restoreAllMocks();

    if (seeded.length > 0) {
      await repo.delete({ id: In(seeded.splice(0)) });
    }
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  async function warmPool(): Promise<void> {
    const runners = [ds.createQueryRunner(), ds.createQueryRunner()];

    await Promise.all(runners.map((r) => r.connect()));
    await Promise.all(runners.map((r) => r.release()));
  }

  function eventFor(providerEventId: string): NormalizedEvent {
    return {
      provider: 'paddle',
      providerEventId,
      type: 'subscription.activated',
      payload: { id: 'sub_race' }
    };
  }

  async function seedRow(
    fields: Pick<WebhookEvent, 'status'> & Partial<WebhookEvent>
  ): Promise<WebhookEvent> {
    const providerEventId = `status-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const row = await repo.save(
      repo.create({
        provider: 'paddle',
        providerEventId,
        type: 'subscription.activated',
        payload: eventFor(providerEventId),
        attempts: 0,
        lastError: null,
        processedAt: null,
        ...fields
      })
    );

    seeded.push(row.id);

    return row;
  }

  function reload(id: string): Promise<WebhookEvent | null> {
    return repo.findOne({ where: { id } });
  }

  describe('admin replay', () => {
    async function buildAdmin(): Promise<BillingAdminService> {
      const module = await Test.createTestingModule({
        providers: [
          BillingAdminService,
          { provide: getDataSourceToken(), useValue: ds },
          {
            provide: getRepositoryToken(Subscription),
            useValue: ds.getRepository(Subscription)
          },
          {
            provide: getRepositoryToken(Invoice),
            useValue: ds.getRepository(Invoice)
          },
          {
            provide: getRepositoryToken(Customer),
            useValue: ds.getRepository(Customer)
          },
          { provide: getRepositoryToken(WebhookEvent), useValue: repo },
          { provide: BillingService, useValue: {} },
          { provide: CreditService, useValue: {} },
          { provide: RenewalService, useValue: {} },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } }
        ]
      }).compile();

      return module.get(BillingAdminService);
    }

    it('lets one of two concurrent replays through and refuses the other', async () => {
      const row = await seedRow({
        status: 'dead_letter',
        attempts: WEBHOOK_MAX_REPLAY_ATTEMPTS
      });
      const service = await buildAdmin();
      const bothRead = barrier(2);
      const findOne = repo.findOne.bind(repo);

      jest.spyOn(repo, 'findOne').mockImplementation(async (options) => {
        const found = await findOne(options);

        await bothRead();

        return found;
      });
      await warmPool();

      const outcomes = await Promise.all([
        service.replayWebhookEvent(row.id).catch((error: unknown) => error),
        service.replayWebhookEvent(row.id).catch((error: unknown) => error)
      ]);

      jest.restoreAllMocks();
      const refused = outcomes.filter((o) => o instanceof Error);

      expect(outcomes).toContainEqual({ id: row.id, status: 'received' });
      expect(refused).toHaveLength(1);
      expectApiError(
        refused[0],
        ErrorKeys.BILLING.WEBHOOK_EVENT_NOT_REPLAYABLE
      );
      expect((await reload(row.id))?.status).toBe('received');
    }, 30000);
  });

  describe('provider redelivery', () => {
    it('does not reset or reduce again a row that settled after the read', async () => {
      const row = await seedRow({ status: 'received' });
      const reduce = jest.fn().mockResolvedValue(undefined);
      const event = eventFor(row.providerEventId);
      const module = await Test.createTestingModule({
        providers: [
          WebhookIngestionService,
          { provide: getRepositoryToken(WebhookEvent), useValue: repo },
          {
            provide: BILLING_PROVIDERS,
            useValue: [
              {
                id: 'paddle',
                verifyAndParseWebhook: jest.fn().mockResolvedValue(event)
              }
            ]
          },
          { provide: BillingEventReducer, useValue: { reduce } }
        ]
      }).compile();
      const service = module.get(WebhookIngestionService);
      const findOne = repo.findOne.bind(repo);

      // The first delivery finishes between the read and the reset.
      jest.spyOn(repo, 'findOne').mockImplementation(async (options) => {
        const found = await findOne(options);

        await repo.update(
          { id: row.id },
          { status: 'processed', processedAt: new Date() }
        );

        return found;
      });

      await service.ingest('paddle', Buffer.from('{}'), {});
      jest.restoreAllMocks();

      expect(reduce).not.toHaveBeenCalled();
      expect((await reload(row.id))?.status).toBe('processed');
    }, 30000);
  });

  describe('sweep failure', () => {
    const later = (): Date =>
      new Date(Date.now() + WEBHOOK_RECEIVED_STUCK_THRESHOLD_MS + 60_000);

    function buildSweep(processEvent: jest.Mock): WebhookReconciliationService {
      const ingestion: Pick<WebhookIngestionService, 'processEvent'> = {
        processEvent
      };

      return new WebhookReconciliationService(
        repo,
        ingestion as WebhookIngestionService
      );
    }

    /** Limits the sweep to the seeded rows and holds it after the read. */
    function gateFind(afterRead: () => Promise<void>): void {
      const find = repo.find.bind(repo);

      jest.spyOn(repo, 'find').mockImplementation(async (options) => {
        const rows = (await find(options)).filter((r) => seeded.includes(r.id));

        await afterRead();

        return rows;
      });
    }

    it('counts the failure of each of two concurrent sweeps', async () => {
      const row = await seedRow({ status: 'received' });
      const processEvent = jest.fn().mockRejectedValue(new Error('down'));

      gateFind(barrier(2));
      await warmPool();
      await Promise.all([
        buildSweep(processEvent).sweep(later()),
        buildSweep(processEvent).sweep(later())
      ]);

      const settled = await reload(row.id);

      expect(processEvent).toHaveBeenCalledTimes(2);
      expect(settled?.attempts).toBe(2);
      expect(settled?.status).toBe('received');
      expect(settled?.lastError).toBe('down');
    }, 30000);

    it('quarantines the row on the failure that reaches the limit', async () => {
      const row = await seedRow({
        status: 'received',
        attempts: WEBHOOK_MAX_REPLAY_ATTEMPTS - 1
      });

      gateFind(() => Promise.resolve());
      await buildSweep(jest.fn().mockRejectedValue(new Error('poison'))).sweep(
        later()
      );

      const settled = await reload(row.id);

      expect(settled?.status).toBe('dead_letter');
      expect(settled?.attempts).toBe(WEBHOOK_MAX_REPLAY_ATTEMPTS);
    }, 30000);

    it('leaves a row alone that settled after the sweep read it', async () => {
      const row = await seedRow({ status: 'received' });

      gateFind(async () => {
        await repo.update(
          { id: row.id },
          { status: 'processed', processedAt: new Date() }
        );
      });
      await buildSweep(jest.fn().mockRejectedValue(new Error('late'))).sweep(
        later()
      );

      const settled = await reload(row.id);

      expect(settled?.status).toBe('processed');
      expect(settled?.attempts).toBe(0);
      expect(settled?.lastError).toBeNull();
    }, 30000);
  });
});
