import { expect } from '@jest/globals';
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
    status: 'received',
    attempts: 0,
    lastError: null,
    payload: { type: 'invoice.paid', providerEventId: 'evt_1' },
    receivedAt: new Date('2026-06-16T00:00:00Z'),
    processedAt: null,
    ...overrides
  };
}

describe('WebhookReconciliationService', () => {
  let find: jest.Mock;
  let update: jest.Mock;
  let processEvent: jest.Mock;
  let service: WebhookReconciliationService;

  beforeEach(() => {
    find = jest.fn();
    update = jest.fn().mockResolvedValue({ affected: 1, raw: [] });
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

  function quarantineWarns(calls: unknown[][]): unknown[][] {
    // The per-tick "Replaying..." warn of the sweep is not a quarantine alert.
    return calls.filter(([message]) => String(message).includes('dead_letter'));
  }

  it('counts a failed replay in SQL, only on a row that is still `received`', async () => {
    const error = jest.spyOn(service['logger'], 'error').mockImplementation();

    processEvent.mockRejectedValue(new Error('boom'));
    find.mockResolvedValue([row({ attempts: 0 })]);
    update.mockResolvedValue({ raw: [{ attempts: 1, status: 'received' }] });

    await service.sweep();

    expect(update).toHaveBeenCalledTimes(1);
    const [[criteria, values, options]] = update.mock.calls as [
      [unknown, Record<string, unknown>, unknown]
    ];

    expect(criteria).toEqual({ id: 'wh-1', status: 'received' });
    expect(values).toEqual({
      attempts: expect.any(Function),
      lastError: 'boom',
      status: expect.any(Function)
    });
    expect(options).toEqual({ returning: ['attempts', 'status'] });
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('alerts once when the counted failure quarantines the row', async () => {
    const warn = jest.spyOn(service['logger'], 'warn').mockImplementation();
    const error = jest.spyOn(service['logger'], 'error').mockImplementation();

    processEvent.mockRejectedValue(new Error('poison'));
    find.mockResolvedValue([
      row({ attempts: WEBHOOK_MAX_REPLAY_ATTEMPTS - 1 })
    ]);
    update.mockResolvedValue({
      raw: [{ attempts: WEBHOOK_MAX_REPLAY_ATTEMPTS, status: 'dead_letter' }]
    });

    await service.sweep();

    expect(quarantineWarns(warn.mock.calls)).toHaveLength(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('logs nothing for a row that left `received` after the sweep read it', async () => {
    const warn = jest.spyOn(service['logger'], 'warn').mockImplementation();
    const error = jest.spyOn(service['logger'], 'error').mockImplementation();

    processEvent.mockRejectedValue(new Error('late'));
    find.mockResolvedValue([row({})]);
    update.mockResolvedValue({ raw: [] });

    await service.sweep();

    expect(quarantineWarns(warn.mock.calls)).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
  });

  it('does nothing when no deliveries are stuck', async () => {
    find.mockResolvedValue([]);

    await service.sweep();

    expect(processEvent).not.toHaveBeenCalled();
  });
});
