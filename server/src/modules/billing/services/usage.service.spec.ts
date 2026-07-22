import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Money } from '@app/shared/utils/money';
import { Subscription } from '../entities/subscription.entity';
import { UsageRecord } from '../entities/usage-record.entity';
import { CreditService } from './credit.service';
import { UsageService } from './usage.service';

type RepoMock = {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
};

function repo(): RepoMock {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((entity: object) => entity),
    save: jest.fn((entity: object) =>
      Promise.resolve({ id: 'usage-1', ...entity })
    )
  };
}

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    customerId: 'cust-1',
    status: 'active',
    ...overrides
  } as Subscription;
}

const INPUT = {
  customerId: 'cust-1',
  meterKey: 'api_calls',
  quantity: 42,
  idempotencyKey: 'evt-1'
};

describe('UsageService', () => {
  let service: UsageService;
  let usageRecords: RepoMock;
  let subscriptions: RepoMock;
  let credits: { isBlocked: jest.Mock };

  beforeEach(async () => {
    usageRecords = repo();
    subscriptions = repo();
    credits = { isBlocked: jest.fn().mockResolvedValue(false) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsageService,
        { provide: getRepositoryToken(UsageRecord), useValue: usageRecords },
        { provide: getRepositoryToken(Subscription), useValue: subscriptions },
        { provide: CreditService, useValue: credits }
      ]
    }).compile();

    service = moduleRef.get(UsageService);
  });

  it('records usage against the customer’s active subscription', async () => {
    subscriptions.findOne.mockResolvedValue(makeSubscription());

    const result = await service.record(INPUT);

    expect(subscriptions.findOne).toHaveBeenCalledTimes(1);
    expect(usageRecords.save).toHaveBeenCalledTimes(1);
    expect(usageRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        subscriptionId: 'sub-1',
        meterKey: 'api_calls',
        quantity: Money.fromMinor(42),
        idempotencyKey: 'evt-1'
      })
    );
    expect(result.id).toBe('usage-1');
  });

  it('defaults occurredAt to now when omitted', async () => {
    subscriptions.findOne.mockResolvedValue(makeSubscription());
    let captured: Partial<UsageRecord> | undefined;
    usageRecords.create.mockImplementation((entity: Partial<UsageRecord>) => {
      captured = entity;
      return entity;
    });

    await service.record(INPUT);

    expect(captured?.occurredAt).toBeInstanceOf(Date);
  });

  it('parses an ISO occurredAt coming straight off the HTTP payload', async () => {
    subscriptions.findOne.mockResolvedValue(makeSubscription());
    let captured: Partial<UsageRecord> | undefined;
    usageRecords.create.mockImplementation((entity: Partial<UsageRecord>) => {
      captured = entity;
      return entity;
    });

    await service.record({ ...INPUT, occurredAt: '2026-01-02T03:04:05.000Z' });

    expect(captured?.occurredAt).toEqual(new Date('2026-01-02T03:04:05.000Z'));
  });

  it('is idempotent: a replayed key returns the existing record without re-inserting', async () => {
    const existing = { id: 'usage-1', idempotencyKey: 'evt-1' } as UsageRecord;
    usageRecords.findOne.mockResolvedValue(existing);

    const result = await service.record(INPUT);

    expect(result).toBe(existing);
    expect(subscriptions.findOne).not.toHaveBeenCalled();
    expect(usageRecords.save).not.toHaveBeenCalled();
  });

  it('returns the winner when an insert loses the unique-key race (23505)', async () => {
    const winner = { id: 'usage-1', idempotencyKey: 'evt-1' } as UsageRecord;
    subscriptions.findOne.mockResolvedValue(makeSubscription());
    // First lookup: no record yet → proceed to insert. Insert hits the unique
    // constraint, so the post-violation lookup returns the concurrent winner.
    usageRecords.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    usageRecords.save.mockRejectedValue({ code: '23505' });

    const result = await service.record(INPUT);

    expect(result).toBe(winner);
  });

  it('rethrows a non-unique save failure', async () => {
    subscriptions.findOne.mockResolvedValue(makeSubscription());
    usageRecords.save.mockRejectedValue({ code: '08006' });

    await expect(service.record(INPUT)).rejects.toMatchObject({
      code: '08006'
    });
  });

  it('throws NotFound when the customer has no active subscription', async () => {
    subscriptions.findOne.mockResolvedValue(null);

    await expect(service.record(INPUT)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(usageRecords.save).not.toHaveBeenCalled();
  });

  it('rejects new usage with 409 while the credit balance is negative', async () => {
    credits.isBlocked.mockResolvedValue(true);
    subscriptions.findOne.mockResolvedValue(makeSubscription());

    await expect(service.record(INPUT)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(usageRecords.save).not.toHaveBeenCalled();
  });

  it('still answers a replayed key while blocked (idempotency wins)', async () => {
    const existing = { id: 'usage-1', idempotencyKey: 'evt-1' } as UsageRecord;
    usageRecords.findOne.mockResolvedValue(existing);
    credits.isBlocked.mockResolvedValue(true);

    await expect(service.record(INPUT)).resolves.toBe(existing);
  });
});
