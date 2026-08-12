import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOneOptions } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import { MetricsService } from '../../core/metrics/metrics.service';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { UsageRecord } from '../entities/usage-record.entity';
import { CreditService } from './credit.service';
import { UsageService } from './usage.service';

type RepoMock = {
  findOne: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
};

function repo(): RepoMock {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
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
    planKey: 'usage',
    ...overrides
  } as Subscription;
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    key: 'usage',
    name: 'Pay as you go',
    billingMode: 'usage',
    meterKey: 'api_calls',
    ...overrides
  } as Plan;
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
  let plans: RepoMock;
  let credits: { isBlocked: jest.Mock };
  let metrics: { recordUnratedUsage: jest.Mock };

  beforeEach(async () => {
    usageRecords = repo();
    subscriptions = repo();
    plans = repo();
    plans.find.mockResolvedValue([makePlan()]);
    credits = { isBlocked: jest.fn().mockResolvedValue(false) };
    metrics = { recordUnratedUsage: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsageService,
        { provide: getRepositoryToken(UsageRecord), useValue: usageRecords },
        { provide: getRepositoryToken(Subscription), useValue: subscriptions },
        { provide: getRepositoryToken(Plan), useValue: plans },
        { provide: CreditService, useValue: credits },
        { provide: MetricsService, useValue: metrics }
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

  it('bills the newest active subscription when the customer has more than one', async () => {
    const older = makeSubscription({
      id: 'sub-old',
      createdAt: new Date('2026-01-01T00:00:00.000Z')
    });
    const newer = makeSubscription({
      id: 'sub-new',
      createdAt: new Date('2026-06-01T00:00:00.000Z')
    });
    // Without an ORDER BY, Postgres is free to return the older row first.
    const rows = [older, newer];
    subscriptions.findOne.mockImplementation(
      (options: FindOneOptions<Subscription>) =>
        Promise.resolve(
          options.order?.createdAt === 'DESC'
            ? [...rows].sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
              )[0]
            : rows[0]
        )
    );

    await service.record(INPUT);

    expect(usageRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 'sub-new' })
    );
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
    const existing = {
      id: 'usage-1',
      customerId: 'cust-1',
      meterKey: 'api_calls',
      idempotencyKey: 'evt-1'
    } as UsageRecord;
    usageRecords.findOne.mockResolvedValue(existing);
    subscriptions.findOne.mockResolvedValue(makeSubscription());
    plans.findOne.mockResolvedValue(makePlan());

    const result = await service.record(INPUT);

    expect(result).toBe(existing);
    expect(usageRecords.save).not.toHaveBeenCalled();
    // The replay still resolves the pricing verdict, so it reports the plan in
    // force now rather than whatever applied when the row was written.
    expect(existing.pricedByCurrentPlan).toBe(true);
  });

  it('reports a replayed record as unpriced once the customer has moved off the metered plan', async () => {
    const existing = {
      id: 'usage-1',
      customerId: 'cust-1',
      meterKey: 'api_calls',
      idempotencyKey: 'evt-1'
    } as UsageRecord;
    usageRecords.findOne.mockResolvedValue(existing);
    subscriptions.findOne.mockResolvedValue(
      makeSubscription({ planKey: 'pro' })
    );
    plans.findOne.mockResolvedValue(makePlan({ key: 'pro', meterKey: null }));

    await service.record(INPUT);

    expect(existing.pricedByCurrentPlan).toBe(false);
  });

  it('treats the same key from another customer as a distinct event', async () => {
    const foreign = {
      id: 'usage-foreign',
      customerId: 'cust-2',
      idempotencyKey: 'evt-1'
    } as UsageRecord;
    subscriptions.findOne.mockResolvedValue(makeSubscription());
    // Emulates the unique constraint's lookup semantics: a column absent from
    // `where` is unconstrained, so an unscoped query matches the foreign row.
    usageRecords.findOne.mockImplementation(
      ({ where }: { where: Partial<UsageRecord> }) =>
        Promise.resolve(
          [foreign].find(
            (r) =>
              r.idempotencyKey === where.idempotencyKey &&
              (where.customerId === undefined ||
                r.customerId === where.customerId)
          ) ?? null
        )
    );

    const result = await service.record(INPUT);

    expect(usageRecords.findOne).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', idempotencyKey: 'evt-1' }
    });
    expect(usageRecords.save).toHaveBeenCalledTimes(1);
    expect(result).not.toBe(foreign);
    expect(result).toMatchObject({ customerId: 'cust-1' });
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
    // The recovery lookup is scoped like the constraint that rejected the insert.
    expect(usageRecords.findOne).toHaveBeenLastCalledWith({
      where: { customerId: 'cust-1', idempotencyKey: 'evt-1' }
    });
  });

  it('recognises the unique violation when TypeORM wraps the driver error', async () => {
    const winner = { id: 'usage-1', idempotencyKey: 'evt-1' } as UsageRecord;
    subscriptions.findOne.mockResolvedValue(makeSubscription());
    usageRecords.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    usageRecords.save.mockRejectedValue({ driverError: { code: '23505' } });

    await expect(service.record(INPUT)).resolves.toBe(winner);
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

  it('rejects a meter no plan in the catalog declares', async () => {
    subscriptions.findOne.mockResolvedValue(makeSubscription());
    // A typo resolves to nothing: neither the customer's plan nor any plan
    // declaring that meter comes back.
    plans.find.mockResolvedValue([makePlan()]);

    await expect(
      service.record({ ...INPUT, meterKey: 'api_call' })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(usageRecords.save).not.toHaveBeenCalled();
    expect(metrics.recordUnratedUsage).not.toHaveBeenCalled();
  });

  it('stores a catalog meter the current plan does not price, and counts it', async () => {
    subscriptions.findOne.mockResolvedValue(
      makeSubscription({ planKey: 'pro' })
    );
    // The customer is on a fixed plan; another plan declares the meter, so the
    // observation is legitimate and simply rates to nothing today.
    plans.find.mockResolvedValue([
      makePlan({ key: 'pro', billingMode: 'fixed', meterKey: null }),
      makePlan()
    ]);

    const result = await service.record(INPUT);

    expect(usageRecords.save).toHaveBeenCalledTimes(1);
    expect(metrics.recordUnratedUsage).toHaveBeenCalledWith('api_calls');
    expect(result.pricedByCurrentPlan).toBe(false);
  });

  it('stores without counting when the meter is the active plan meter', async () => {
    subscriptions.findOne.mockResolvedValue(makeSubscription());

    const result = await service.record(INPUT);

    expect(usageRecords.save).toHaveBeenCalledTimes(1);
    expect(metrics.recordUnratedUsage).not.toHaveBeenCalled();
    expect(result.pricedByCurrentPlan).toBe(true);
  });

  it('counts a dangling planKey as unrated rather than refusing the record', async () => {
    subscriptions.findOne.mockResolvedValue(
      makeSubscription({ planKey: 'deleted-plan' })
    );
    plans.find.mockResolvedValue([makePlan()]);

    await service.record(INPUT);

    expect(usageRecords.save).toHaveBeenCalledTimes(1);
    expect(metrics.recordUnratedUsage).toHaveBeenCalledWith('api_calls');
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
