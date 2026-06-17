import { FindOperator, type Repository } from 'typeorm';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { WebhookReconciliationService } from './webhook-reconciliation.service';
import { WebhookIngestionService } from './webhook-ingestion.service';
import {
  WEBHOOK_MAX_REPLAY_ATTEMPTS,
  WEBHOOK_RECEIVED_STUCK_THRESHOLD_MS
} from './billing-webhook-queue.constants';

function row(overrides: Partial<WebhookEvent>): WebhookEvent {
  return {
    id: 'wh-1',
    provider: 'paddle',
    providerEventId: 'evt_1',
    type: 'invoice.paid',
    payloadHash: 'hash',
    status: 'received',
    attempts: 0,
    lastError: null,
    payload: { type: 'invoice.paid', providerEventId: 'evt_1' },
    receivedAt: new Date('2026-06-16T00:00:00Z'),
    processedAt: null,
    ...overrides
  } as WebhookEvent;
}

describe('WebhookReconciliationService', () => {
  let find: jest.Mock;
  let update: jest.Mock;
  let processEvent: jest.Mock;
  let service: WebhookReconciliationService;

  beforeEach(() => {
    find = jest.fn();
    update = jest.fn().mockResolvedValue({ affected: 1 });
    processEvent = jest.fn().mockResolvedValue(undefined);
    const repo: Pick<Repository<WebhookEvent>, 'find' | 'update'> = {
      find,
      update
    };
    const ingestion: Pick<WebhookIngestionService, 'processEvent'> = {
      processEvent
    };
    service = new WebhookReconciliationService(
      repo as Repository<WebhookEvent>,
      ingestion as WebhookIngestionService
    );
  });

  it('queries only `received` rows older than the stuck threshold', async () => {
    let where: { status: string; receivedAt: FindOperator<Date> } | undefined;
    find.mockImplementation(
      (opts: { where: { status: string; receivedAt: FindOperator<Date> } }) => {
        where = opts.where;
        return Promise.resolve([]);
      }
    );
    const now = new Date('2026-06-16T12:00:00Z');

    await service.sweep(now);

    expect(find).toHaveBeenCalledTimes(1);
    expect(where?.status).toBe('received');
    expect(where?.receivedAt).toBeInstanceOf(FindOperator);
    expect(where?.receivedAt.value).toEqual(
      new Date(now.getTime() - WEBHOOK_RECEIVED_STUCK_THRESHOLD_MS)
    );
  });

  it('replays each stuck row from its persisted event', async () => {
    const a = row({ id: 'wh-a', providerEventId: 'evt_a' });
    const b = row({ id: 'wh-b', providerEventId: 'evt_b' });
    find.mockResolvedValue([a, b]);

    await service.sweep();

    expect(processEvent).toHaveBeenCalledTimes(2);
    expect(processEvent).toHaveBeenNthCalledWith(1, {
      webhookEventId: 'wh-a',
      event: a.payload
    });
    expect(processEvent).toHaveBeenNthCalledWith(2, {
      webhookEventId: 'wh-b',
      event: b.payload
    });
  });

  it('skips a row with no persisted payload (cannot replay without the provider)', async () => {
    find.mockResolvedValue([row({ payload: null })]);

    await service.sweep();

    expect(processEvent).not.toHaveBeenCalled();
  });

  it('continues replaying after one row fails', async () => {
    processEvent
      .mockRejectedValueOnce(new Error('still failing'))
      .mockResolvedValue(undefined);
    find.mockResolvedValue([
      row({ id: 'wh-a', providerEventId: 'evt_a' }),
      row({ id: 'wh-b', providerEventId: 'evt_b' })
    ]);

    await expect(service.sweep()).resolves.toBeUndefined();
    expect(processEvent).toHaveBeenCalledTimes(2);
  });

  it('records attempts/last_error on a failed replay without quarantining early', async () => {
    processEvent.mockRejectedValue(new Error('boom'));
    find.mockResolvedValue([row({ attempts: 0 })]);

    await service.sweep();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      { id: 'wh-1' },
      { attempts: 1, lastError: 'boom' }
    );
  });

  it('quarantines a delivery on its Nth failure and alerts exactly once', async () => {
    const warn = jest.spyOn(service['logger'], 'warn').mockImplementation();
    const error = jest.spyOn(service['logger'], 'error').mockImplementation();
    processEvent.mockRejectedValue(new Error('poison'));

    // A stateful row whose attempts persist across ticks; once it flips to
    // `dead_letter` the sweep query (status `received`) no longer returns it.
    const persisted = row({ attempts: 0 });
    update.mockImplementation(
      (_criteria: unknown, patch: Partial<WebhookEvent>) => {
        Object.assign(persisted, patch);
        return Promise.resolve({ affected: 1 });
      }
    );
    find.mockImplementation(() =>
      Promise.resolve(persisted.status === 'received' ? [persisted] : [])
    );

    // More ticks than the threshold proves the row stops being swept once
    // quarantined rather than churning forever.
    for (let i = 0; i < WEBHOOK_MAX_REPLAY_ATTEMPTS + 3; i++) {
      await service.sweep();
    }

    expect(persisted.status).toBe('dead_letter');
    expect(persisted.attempts).toBe(WEBHOOK_MAX_REPLAY_ATTEMPTS);
    expect(processEvent).toHaveBeenCalledTimes(WEBHOOK_MAX_REPLAY_ATTEMPTS);
    // Exactly one quarantine alert on the transition; the per-attempt failures
    // before it use error() (the sweep's own per-tick "Replaying..." warns are
    // not quarantine alerts, so filter the message).
    const quarantineWarns = warn.mock.calls.filter((c) =>
      String(c[0]).includes('dead_letter')
    );
    expect(quarantineWarns).toHaveLength(1);
    expect(error).toHaveBeenCalledTimes(WEBHOOK_MAX_REPLAY_ATTEMPTS - 1);
  });

  it('does nothing when no deliveries are stuck', async () => {
    find.mockResolvedValue([]);

    await service.sweep();

    expect(processEvent).not.toHaveBeenCalled();
  });
});
