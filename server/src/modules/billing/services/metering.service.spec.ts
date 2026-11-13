import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { Money } from '@app/shared/utils/money';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { AuditService } from '../../audit/audit.service';
import { EntitlementService } from '../../entitlements/entitlement.service';
import { Customer } from '../entities/customer.entity';
import { UsageRecord } from '../entities/usage-record.entity';
import { CreditBalanceCrossedEvent } from '../events/billing.events';
import { expectRefusal } from '../testing/billing-service.fixtures';
import { CreditService } from './credit.service';
import { MeteringService } from './metering.service';

const NOW = new Date('2026-11-13T10:00:00Z');
const AUDIT = {
  action: AuditAction.BILLING_USAGE_RECORD,
  actorId: 'admin-1',
  actorEmail: null,
  targetType: 'UsageRecord'
};

async function build({
  balance = 10,
  existing = null,
  planCapabilities = null
}: {
  balance?: number;
  existing?: Partial<UsageRecord> | null;
  planCapabilities?: string[] | null;
} = {}) {
  const manager = {
    findOne: jest.fn().mockResolvedValue(existing),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn((record: object) =>
      Promise.resolve({ id: 'use-1', ...record })
    )
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager))
  };
  const credits = {
    lockedBalance: jest.fn().mockResolvedValue(balance),
    getBalance: jest.fn().mockResolvedValue(null),
    spendOnMetering: jest.fn(
      (_m: unknown, _ref: unknown, units: number): Promise<object> =>
        Promise.resolve({ before: balance, after: balance - units })
    )
  };
  const entitlements = {
    subscriptionPlan: jest
      .fn()
      .mockResolvedValue(
        planCapabilities
          ? { planKey: 'pro', capabilities: planCapabilities, limits: {} }
          : null
      )
  };
  const customers = {
    findOne: jest.fn().mockResolvedValue({ id: 'cust-1', userId: 'user-1' })
  };
  const usageRecords = { findOne: jest.fn().mockResolvedValue(null) };
  const emit = jest.fn();
  const audit = { logFireAndForget: jest.fn() };

  const moduleRef = await Test.createTestingModule({
    providers: [
      MeteringService,
      { provide: getRepositoryToken(UsageRecord), useValue: usageRecords },
      { provide: getRepositoryToken(Customer), useValue: customers },
      { provide: getDataSourceToken(), useValue: dataSource },
      { provide: CreditService, useValue: credits },
      { provide: EntitlementService, useValue: entitlements },
      { provide: EventEmitter2, useValue: { emit } },
      { provide: AuditService, useValue: audit }
    ]
  }).compile();

  return {
    service: moduleRef.get(MeteringService),
    manager,
    dataSource,
    credits,
    entitlements,
    emit,
    audit
  };
}

function use(overrides: Record<string, unknown> = {}) {
  return {
    meterKey: 'api_calls',
    units: 3,
    idempotencyKey: 'evt-1',
    ...overrides
  };
}

describe('MeteringService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('debits the units under the balance lock and stores a record with no subscription', async () => {
    const ctx = await build({ balance: 10 });

    await expect(
      ctx.service.consume('cust-1', use(), { audit: AUDIT })
    ).resolves.toEqual({
      recordId: 'use-1',
      debited: true,
      replayed: false,
      balanceAfter: 7
    });

    expect(ctx.credits.lockedBalance).toHaveBeenCalledWith(
      ctx.manager,
      'cust-1'
    );
    expect(ctx.manager.create).toHaveBeenCalledWith(UsageRecord, {
      customerId: 'cust-1',
      subscriptionId: null,
      meterKey: 'api_calls',
      quantity: Money.fromMinor(3),
      occurredAt: NOW,
      idempotencyKey: 'evt-1'
    });
    expect(ctx.credits.spendOnMetering).toHaveBeenCalledWith(
      ctx.manager,
      { customerId: 'cust-1', usageRecordId: 'use-1' },
      3
    );
    expect(ctx.audit.logFireAndForget).toHaveBeenCalledWith({
      ...AUDIT,
      targetId: 'use-1'
    });
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it('emits the balance crossing once when a debit takes the balance to 0', async () => {
    const ctx = await build({ balance: 3 });

    await ctx.service.consume('cust-1', use({ units: 3 }));

    expect(ctx.emit).toHaveBeenCalledTimes(1);
    expect(ctx.emit).toHaveBeenCalledWith(
      CreditBalanceCrossedEvent.name,
      new CreditBalanceCrossedEvent('user-1')
    );
  });

  it.each([
    ['fewer units than the use', 2],
    ['a balance of 0', 0],
    ['a clawed-back debt', -50]
  ])('refuses a use with %s, and writes nothing', async (_name, balance) => {
    const ctx = await build({ balance });

    await expectRefusal(
      ctx.service.consume('cust-1', use({ units: 3 }), { audit: AUDIT }),
      ErrorKeys.BILLING.INSUFFICIENT_CREDITS
    );
    expect(ctx.manager.save).not.toHaveBeenCalled();
    expect(ctx.credits.spendOnMetering).not.toHaveBeenCalled();
    expect(ctx.audit.logFireAndForget).not.toHaveBeenCalled();
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it('does not debit a subscriber whose plan has the capability of the meter', async () => {
    const ctx = await build({
      balance: 500,
      planCapabilities: ['reports', 'api-access']
    });

    await expect(
      ctx.service.consume('cust-1', use(), { audit: AUDIT })
    ).resolves.toEqual({
      recordId: null,
      debited: false,
      replayed: false,
      balanceAfter: 500
    });
    expect(ctx.entitlements.subscriptionPlan).toHaveBeenCalledWith('cust-1');
    expect(ctx.manager.save).not.toHaveBeenCalled();
    expect(ctx.audit.logFireAndForget).not.toHaveBeenCalled();
  });

  it('debits a subscriber whose plan lacks the capability of the meter', async () => {
    const ctx = await build({ balance: 10, planCapabilities: ['reports'] });

    const result = await ctx.service.consume('cust-1', use());

    expect(result.debited).toBe(true);
    expect(ctx.credits.spendOnMetering).toHaveBeenCalled();
  });

  it('answers a replay with the first record and debits nothing again', async () => {
    const ctx = await build({
      balance: 7,
      existing: {
        id: 'use-1',
        meterKey: 'api_calls',
        quantity: Money.fromMinor(3),
        occurredAt: new Date(NOW.getTime() - 60_000)
      }
    });

    await expect(
      ctx.service.consume('cust-1', use(), { audit: AUDIT })
    ).resolves.toEqual({
      recordId: 'use-1',
      debited: true,
      replayed: true,
      balanceAfter: 7
    });
    expect(ctx.manager.save).not.toHaveBeenCalled();
    expect(ctx.credits.spendOnMetering).not.toHaveBeenCalled();
    expect(ctx.audit.logFireAndForget).not.toHaveBeenCalled();
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it.each([
    ['another quantity', { units: 4 }],
    ['another occurredAt', { occurredAt: NOW.toISOString() }]
  ])('refuses the key reused with %s', async (_name, overrides) => {
    const ctx = await build({
      existing: {
        id: 'use-1',
        meterKey: 'api_calls',
        quantity: Money.fromMinor(3),
        occurredAt: new Date(NOW.getTime() - 60_000)
      }
    });

    await expectRefusal(
      ctx.service.consume('cust-1', use(overrides)),
      ErrorKeys.BILLING.USAGE_KEY_REUSED
    );
    expect(ctx.manager.save).not.toHaveBeenCalled();
  });

  it('refuses a meter outside the catalog before it opens a transaction', async () => {
    const ctx = await build();

    await expectRefusal(
      ctx.service.consume('cust-1', use({ meterKey: 'typo_calls' })),
      ErrorKeys.BILLING.METER_NOT_DECLARED
    );
    expect(ctx.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('refuses an occurredAt past the clock skew tolerance', async () => {
    const ctx = await build();

    await expectRefusal(
      ctx.service.consume(
        'cust-1',
        use({ occurredAt: new Date(NOW.getTime() + 6 * 60_000).toISOString() })
      ),
      ErrorKeys.BILLING.USAGE_IN_FUTURE
    );
    expect(ctx.dataSource.transaction).not.toHaveBeenCalled();
  });
});
