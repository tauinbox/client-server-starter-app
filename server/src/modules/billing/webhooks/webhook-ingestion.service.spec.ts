import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { createHash } from 'crypto';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { BILLING_PROVIDERS } from '../providers/payment-provider.interface';
import type { NormalizedEvent } from '../providers/payment-provider.interface';
import { BillingEventReducer } from './billing-event-reducer.service';
import { WebhookIngestionService } from './webhook-ingestion.service';
import {
  BILLING_WEBHOOK_QUEUE,
  BILLING_WEBHOOK_REDUCE_JOB
} from './billing-webhook-queue.constants';

const event: NormalizedEvent = {
  provider: 'paddle',
  providerEventId: 'evt_123',
  type: 'subscription.activated',
  payload: { id: 'sub_1' }
};

interface Harness {
  service: WebhookIngestionService;
  values: jest.Mock;
  execute: jest.Mock;
  findOne: jest.Mock;
  update: jest.Mock;
  add: jest.Mock;
  verify: jest.Mock;
  reduce: jest.Mock;
}

async function buildHarness(opts: {
  withQueue: boolean;
  verify?: jest.Mock;
}): Promise<Harness> {
  const values = jest.fn();
  const execute = jest.fn().mockResolvedValue({ raw: [{ id: 'wh-1' }] });
  const qb = {
    insert: jest.fn().mockReturnThis(),
    values,
    orIgnore: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute
  };
  values.mockReturnValue(qb);
  // On an insert conflict the service looks up the existing row to decide
  // whether to skip (already `processed`) or reprocess (still `received`).
  const findOne = jest
    .fn()
    .mockResolvedValue({ id: 'wh-1', status: 'processed' });
  const repo = {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    findOne,
    update: jest.fn().mockResolvedValue({ affected: 1 })
  };
  const verify = opts.verify ?? jest.fn().mockResolvedValue(event);
  const paddle = { id: 'paddle', verifyAndParseWebhook: verify };
  const yookassa = { id: 'yookassa', verifyAndParseWebhook: jest.fn() };
  const add = jest.fn().mockResolvedValue(undefined);
  const reduce = jest.fn().mockResolvedValue(undefined);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      WebhookIngestionService,
      { provide: getRepositoryToken(WebhookEvent), useValue: repo },
      { provide: BILLING_PROVIDERS, useValue: [paddle, yookassa] },
      { provide: BillingEventReducer, useValue: { reduce } },
      ...(opts.withQueue
        ? [{ provide: getQueueToken(BILLING_WEBHOOK_QUEUE), useValue: { add } }]
        : [])
    ]
  }).compile();

  return {
    service: module.get(WebhookIngestionService),
    values,
    execute,
    findOne,
    update: repo.update,
    add,
    verify,
    reduce
  };
}

describe('WebhookIngestionService', () => {
  it('rejects an empty body without touching the provider', async () => {
    const { service, verify } = await buildHarness({ withQueue: false });
    await expect(
      service.ingest('paddle', Buffer.alloc(0), {})
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects an unverifiable webhook (provider returns null)', async () => {
    const { service, execute } = await buildHarness({
      withQueue: false,
      verify: jest.fn().mockResolvedValue(null)
    });
    await expect(
      service.ingest('paddle', Buffer.from('{}'), {})
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes the raw bytes to the provider and hashes them for the ledger', async () => {
    const { service, verify, values } = await buildHarness({
      withQueue: false
    });
    const raw = Buffer.from('{"id":"evt_123"}');

    await service.ingest('paddle', raw, { 'paddle-signature': 'sig' });

    expect(verify).toHaveBeenCalledWith(raw, { 'paddle-signature': 'sig' });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadHash: createHash('sha256').update(raw).digest('hex'),
        // The verified event is persisted so the reconciliation sweep can
        // replay a stuck delivery without the provider.
        payload: event,
        status: 'received'
      })
    );
  });

  it('processes a verified event once and no-ops the replay', async () => {
    const { service, execute, update, reduce } = await buildHarness({
      withQueue: false
    });
    // First delivery inserts a row; replay hits the unique constraint (no row).
    execute
      .mockResolvedValueOnce({ raw: [{ id: 'wh-1' }] })
      .mockResolvedValueOnce({ raw: [] });

    await service.ingest('paddle', Buffer.from('{}'), {});
    await service.ingest('paddle', Buffer.from('{}'), {});

    expect(execute).toHaveBeenCalledTimes(2);
    // Reduce + mark-processed run once (first delivery); the replay no-ops.
    expect(reduce).toHaveBeenCalledTimes(1);
    expect(reduce).toHaveBeenCalledWith(event);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      { id: 'wh-1' },
      expect.objectContaining({ status: 'processed' })
    );
  });

  it('reprocesses when the conflicting row is still `received` (unfinished delivery)', async () => {
    const { service, execute, findOne, reduce } = await buildHarness({
      withQueue: false
    });
    execute.mockResolvedValueOnce({ raw: [] }); // insert loses the unique race
    findOne.mockResolvedValueOnce({ id: 'wh-7', status: 'received' });

    await service.ingest('paddle', Buffer.from('{}'), {});

    expect(reduce).toHaveBeenCalledTimes(1);
    expect(reduce).toHaveBeenCalledWith(event);
  });

  it('no-ops when the conflicting row is already `processed`', async () => {
    const { service, execute, findOne, reduce } = await buildHarness({
      withQueue: false
    });
    execute.mockResolvedValueOnce({ raw: [] });
    findOne.mockResolvedValueOnce({ id: 'wh-7', status: 'processed' });

    await service.ingest('paddle', Buffer.from('{}'), {});

    expect(reduce).not.toHaveBeenCalled();
  });

  it('enqueues reduction when a queue is configured', async () => {
    const { service, add, update, reduce } = await buildHarness({
      withQueue: true
    });

    await service.ingest('paddle', Buffer.from('{}'), {});

    expect(add).toHaveBeenCalledWith(
      BILLING_WEBHOOK_REDUCE_JOB,
      { webhookEventId: 'wh-1', event },
      expect.objectContaining({ attempts: expect.any(Number) as unknown })
    );
    // With a queue the reduction is deferred to the worker, not run inline.
    expect(reduce).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
