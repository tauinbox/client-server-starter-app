import { FindOperator, type Repository } from 'typeorm';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { WebhookReconciliationService } from './webhook-reconciliation.service';
import { WebhookIngestionService } from './webhook-ingestion.service';
import { WEBHOOK_RECEIVED_STUCK_THRESHOLD_MS } from './billing-webhook-queue.constants';

function row(overrides: Partial<WebhookEvent>): WebhookEvent {
  return {
    id: 'wh-1',
    provider: 'paddle',
    providerEventId: 'evt_1',
    type: 'invoice.paid',
    payloadHash: 'hash',
    status: 'received',
    payload: { type: 'invoice.paid', providerEventId: 'evt_1' },
    receivedAt: new Date('2026-06-16T00:00:00Z'),
    processedAt: null,
    ...overrides
  } as WebhookEvent;
}

describe('WebhookReconciliationService', () => {
  let find: jest.Mock;
  let processEvent: jest.Mock;
  let service: WebhookReconciliationService;

  beforeEach(() => {
    find = jest.fn();
    processEvent = jest.fn().mockResolvedValue(undefined);
    const repo: Pick<Repository<WebhookEvent>, 'find'> = { find };
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

  it('does nothing when no deliveries are stuck', async () => {
    find.mockResolvedValue([]);

    await service.sweep();

    expect(processEvent).not.toHaveBeenCalled();
  });
});
