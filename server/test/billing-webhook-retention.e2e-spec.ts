// The retention sweep against a real PostgreSQL. Its statements carry a LIMIT
// inside the sub-select they match on - something no mocked repository can
// prove valid - and the whole point of the job is which rows survive it.

import { ConfigService } from '@nestjs/config';
import { DataSource, In, Repository } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';
import { WebhookEvent } from '../src/modules/billing/entities/webhook-event.entity';
import { WebhookRetentionService } from '../src/modules/billing/webhooks/webhook-retention.service';
import { WEBHOOK_RETENTION_BATCH_SIZE } from '../src/modules/billing/webhooks/billing-webhook-queue.constants';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const DAY = 86_400_000;
const PREFIX = 'wr-';
const NOW = new Date('2026-08-10T00:00:00Z');
const RETENTION_DAYS = 90;
const PAYLOAD_RETENTION_DAYS = 7;

runWithInfra('billing webhook ledger retention (e2e)', () => {
  let ds: DataSource;
  let events: Repository<WebhookEvent>;
  let service: WebhookRetentionService;

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
    events = ds.getRepository(WebhookEvent);
    service = new WebhookRetentionService(
      events,
      new ConfigService({
        BILLING_WEBHOOK_RETENTION_DAYS: String(RETENTION_DAYS),
        BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS: String(PAYLOAD_RETENTION_DAYS)
      })
    );
  }, 60000);

  afterEach(() => purge());

  afterAll(async () => {
    await purge();
    await ds?.destroy();
  });

  function purge(): Promise<unknown> {
    return ds
      .createQueryBuilder()
      .delete()
      .from(WebhookEvent)
      .where('provider_event_id LIKE :prefix', { prefix: `${PREFIX}%` })
      .execute();
  }

  async function seed(
    rows: Array<{ key: string; status: string; ageDays: number }>
  ): Promise<void> {
    await events.save(
      rows.map((row) =>
        events.create({
          provider: 'yookassa',
          providerEventId: `${PREFIX}${row.key}`,
          type: 'invoice.paid',
          status: row.status,
          payload: { type: 'invoice.paid', providerEventId: row.key },
          receivedAt: new Date(NOW.getTime() - row.ageDays * DAY),
          processedAt: row.status === 'processed' ? NOW : null
        })
      )
    );
  }

  function read(key: string): Promise<WebhookEvent | null> {
    return events.findOne({ where: { providerEventId: `${PREFIX}${key}` } });
  }

  it('deletes settled deliveries past the retention window only', async () => {
    await seed([
      { key: 'old-processed', status: 'processed', ageDays: 91 },
      { key: 'young-processed', status: 'processed', ageDays: 89 },
      { key: 'old-received', status: 'received', ageDays: 400 },
      { key: 'old-dead', status: 'dead_letter', ageDays: 400 }
    ]);

    await service.sweep(NOW);

    expect(await read('old-processed')).toBeNull();
    expect(await read('young-processed')).not.toBeNull();
    // Both are still actionable: the reconciliation sweep replays a `received`
    // row from its payload, and an admin can requeue a `dead_letter` one.
    expect(await read('old-received')).not.toBeNull();
    expect(await read('old-dead')).not.toBeNull();
  });

  it('drops the payload of a settled delivery ahead of the row itself', async () => {
    await seed([
      { key: 'redact', status: 'processed', ageDays: 8 },
      { key: 'keep', status: 'processed', ageDays: 6 },
      { key: 'stuck', status: 'received', ageDays: 400 },
      { key: 'dead', status: 'dead_letter', ageDays: 400 }
    ]);

    await service.sweep(NOW);

    const redacted = await read('redact');
    expect(redacted).not.toBeNull();
    expect(redacted?.payload).toBeNull();
    expect((await read('keep'))?.payload).not.toBeNull();
    // A replayable delivery keeps the event it would be replayed from.
    expect((await read('stuck'))?.payload).not.toBeNull();
    expect((await read('dead'))?.payload).not.toBeNull();
  });

  it('works through a backlog larger than one batch', async () => {
    const backlog = WEBHOOK_RETENTION_BATCH_SIZE + 25;
    await seed(
      Array.from({ length: backlog }, (_, i) => ({
        key: `bulk-${i}`,
        status: 'processed',
        ageDays: 120
      }))
    );

    await service.sweep(NOW);

    const remaining = await events.countBy({
      providerEventId: In(
        Array.from({ length: backlog }, (_, i) => `${PREFIX}bulk-${i}`)
      )
    });
    expect(remaining).toBe(0);
  });

  it('is a no-op on a second sweep with nothing newly expired', async () => {
    await seed([{ key: 'settled', status: 'processed', ageDays: 8 }]);

    await service.sweep(NOW);
    await expect(service.sweep(NOW)).resolves.toBeUndefined();

    expect((await read('settled'))?.payload).toBeNull();
  });
});
