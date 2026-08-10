import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { WebhookRetentionService } from './webhook-retention.service';
import {
  DEFAULT_WEBHOOK_PAYLOAD_RETENTION_DAYS,
  DEFAULT_WEBHOOK_RETENTION_DAYS,
  WEBHOOK_RETENTION_BATCH_SIZE,
  WEBHOOK_RETENTION_MAX_ROWS_PER_SWEEP
} from './billing-webhook-queue.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

interface CapturedStatement {
  kind: 'update' | 'delete';
  set?: Partial<WebhookEvent>;
  where: string;
  params: { cutoff: Date; limit: number };
}

describe('WebhookRetentionService', () => {
  let statements: CapturedStatement[];
  let affected: (statement: CapturedStatement) => number;
  let service: WebhookRetentionService;

  /**
   * Records the statement each builder chain produces and answers with the
   * `affected` count the case under test wants, so the batching loop and the
   * generated SQL can both be asserted without a database.
   */
  function makeRepo(): Repository<WebhookEvent> {
    const builder = (kind: 'update' | 'delete') => {
      const statement: Partial<CapturedStatement> = { kind };
      const chain = {
        set(values: Partial<WebhookEvent>) {
          statement.set = values;
          return chain;
        },
        where(where: string, params: { cutoff: Date; limit: number }) {
          statement.where = where;
          statement.params = params;
          return chain;
        },
        execute() {
          const captured = statement as CapturedStatement;
          statements.push(captured);
          return Promise.resolve({ affected: affected(captured) });
        }
      };
      return chain;
    };

    const repo = {
      metadata: { tableName: 'billing_webhook_events' },
      createQueryBuilder: () => ({
        update: () => builder('update'),
        delete: () => builder('delete')
      })
    };
    // @ts-expect-error stand-in for the repository: the service only reads
    // metadata.tableName and drives the update/delete builder chain.
    return repo;
  }

  function build(env: Record<string, string> = {}): WebhookRetentionService {
    return new WebhookRetentionService(makeRepo(), new ConfigService(env));
  }

  beforeEach(() => {
    statements = [];
    affected = () => 0;
    service = build();
  });

  it('redacts and prunes only settled deliveries, oldest-first by received_at', async () => {
    await service.sweep(new Date('2026-08-10T00:00:00Z'));

    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement.where).toContain(`status = 'processed'`);
      expect(statement.where).toContain('received_at < :cutoff');
      expect(statement.where).not.toContain('dead_letter');
    }
  });

  it('applies the default windows measured back from the sweep time', async () => {
    const now = new Date('2026-08-10T00:00:00Z');

    await service.sweep(now);

    const [redact, prune] = statements;
    expect(redact.kind).toBe('update');
    expect(redact.set).toEqual({ payload: null });
    expect(redact.params.cutoff).toEqual(
      new Date(now.getTime() - DEFAULT_WEBHOOK_PAYLOAD_RETENTION_DAYS * DAY_MS)
    );
    expect(prune.kind).toBe('delete');
    expect(prune.params.cutoff).toEqual(
      new Date(now.getTime() - DEFAULT_WEBHOOK_RETENTION_DAYS * DAY_MS)
    );
  });

  it('honours the env-configured windows', async () => {
    const now = new Date('2026-08-10T00:00:00Z');
    service = build({
      BILLING_WEBHOOK_RETENTION_DAYS: '30',
      BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS: '2'
    });

    await service.sweep(now);

    expect(statements[0].params.cutoff).toEqual(
      new Date(now.getTime() - 2 * DAY_MS)
    );
    expect(statements[1].params.cutoff).toEqual(
      new Date(now.getTime() - 30 * DAY_MS)
    );
  });

  it('skips rows whose payload is already gone, so redaction terminates', async () => {
    await service.sweep();

    expect(statements[0].where).toContain('payload IS NOT NULL');
    expect(statements[1].where).not.toContain('payload IS NOT NULL');
  });

  it('keeps batching while a statement fills its batch', async () => {
    let deletes = 0;
    affected = (statement) => {
      if (statement.kind === 'update') return 0;
      deletes++;
      return deletes < 3 ? statement.params.limit : 4;
    };

    await service.sweep();

    const deleteStatements = statements.filter((s) => s.kind === 'delete');
    expect(deleteStatements).toHaveLength(3);
    for (const statement of deleteStatements) {
      expect(statement.params.limit).toBe(WEBHOOK_RETENTION_BATCH_SIZE);
    }
  });

  it('stops at the per-sweep ceiling instead of deleting a whole backlog at once', async () => {
    const warn = jest.spyOn(service['logger'], 'warn').mockImplementation();
    affected = (statement) =>
      statement.kind === 'delete' ? statement.params.limit : 0;

    await service.sweep();

    const deleted = statements
      .filter((s) => s.kind === 'delete')
      .reduce((sum, s) => sum + s.params.limit, 0);
    expect(deleted).toBe(WEBHOOK_RETENTION_MAX_ROWS_PER_SWEEP);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when there is nothing to prune', async () => {
    const log = jest.spyOn(service['logger'], 'log').mockImplementation();

    await service.sweep();

    expect(log).not.toHaveBeenCalled();
  });
});
