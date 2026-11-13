// Pay as you go against a real PostgreSQL: a metered use takes its units from
// the credit balance under the balance row lock. These cases force the
// interleavings that the lock exists for.

import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { Money } from '@app/shared/utils/money';
import { postgresConfig } from '../src/postgres.config';
import { User } from '../src/modules/users/entities/user.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { EntitlementService } from '../src/modules/entitlements/entitlement.service';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { CreditBalance } from '../src/modules/billing/entities/credit-balance.entity';
import { CreditLedger } from '../src/modules/billing/entities/credit-ledger.entity';
import { UsageRecord } from '../src/modules/billing/entities/usage-record.entity';
import { CreditBalanceCrossedEvent } from '../src/modules/billing/events/billing.events';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { MeteringService } from '../src/modules/billing/services/metering.service';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const WAIT_TIMEOUT_MS = 10_000;

runWithInfra('Pay-as-you-go metering on real PostgreSQL (e2e)', () => {
  let ds: DataSource;
  let userId: string | undefined;
  let customerId: string;
  let emit: jest.Mock;

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
  });

  beforeEach(async () => {
    emit = jest.fn();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `metering-${stamp}@example.com`,
        name: 'Metering Race',
        password: 'hashed'
      })
    );

    userId = user.id;
    const customer = await ds.getRepository(Customer).save(
      ds.getRepository(Customer).create({
        userId: user.id,
        provider: 'yookassa',
        providerOverride: null,
        providerCustomerId: `cus_${stamp}`,
        country: 'RU',
        currency: 'RUB',
        defaultPaymentMethodId: null
      })
    );

    customerId = customer.id;
  });

  afterEach(async () => {
    // The ledger holds the customer under RESTRICT, so it goes first.
    await ds.getRepository(CreditLedger).delete({ customerId });
    await ds.getRepository(UsageRecord).delete({ customerId });
    await ds.getRepository(CreditBalance).delete({ customerId });

    if (userId) {
      await ds.getRepository(User).delete({ id: userId });
      userId = undefined;
    }
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  async function build(credits: CreditService): Promise<MeteringService> {
    const module = await Test.createTestingModule({
      providers: [
        MeteringService,
        { provide: CreditService, useValue: credits },
        { provide: getDataSourceToken(), useValue: ds },
        {
          provide: getRepositoryToken(UsageRecord),
          useValue: ds.getRepository(UsageRecord)
        },
        {
          provide: getRepositoryToken(Customer),
          useValue: ds.getRepository(Customer)
        },
        {
          provide: EntitlementService,
          useValue: { subscriptionPlan: () => Promise.resolve(null) }
        },
        { provide: EventEmitter2, useValue: { emit } },
        { provide: AuditService, useValue: { logFireAndForget: jest.fn() } }
      ]
    }).compile();

    return module.get(MeteringService);
  }

  function realCredits(): CreditService {
    return new CreditService(ds.getRepository(CreditBalance));
  }

  async function setBalance(units: number): Promise<void> {
    await ds
      .getRepository(CreditBalance)
      .insert({ customerId, balanceUnits: Money.fromMinor(units) });
  }

  async function balance(): Promise<number> {
    const row = await ds
      .getRepository(CreditBalance)
      .findOneByOrFail({ customerId });

    return row.balanceUnits.toNumber();
  }

  function use(idempotencyKey: string, units = 1) {
    return { meterKey: 'api_calls', units, idempotencyKey };
  }

  /** Resolves once a backend waits on a row lock, or fails after a timeout. */
  async function untilABackendWaitsOnALock(): Promise<void> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const [{ waiting }] = await ds.query<{ waiting: string }[]>(
        `SELECT count(*) AS waiting FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`
      );

      if (Number(waiting) > 0) return;

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error('No second debit waited on the balance row lock');
  }

  /**
   * A `CreditService` whose first `lockedBalance` holds its transaction open,
   * with the row lock taken, until `release` is called.
   */
  function gatedCredits(): {
    credits: CreditService;
    locked: Promise<void>;
    release: () => void;
  } {
    const credits = realCredits();
    const read = credits.lockedBalance.bind(credits);
    const lockTaken = Promise.withResolvers<void>();
    const { promise: released, resolve: release } =
      Promise.withResolvers<void>();
    let first = true;

    credits.lockedBalance = async (
      manager: EntityManager,
      id: string
    ): Promise<number> => {
      const units = await read(manager, id);

      if (first) {
        first = false;
        lockTaken.resolve();
        await released;
      }

      return units;
    };

    return { credits, locked: lockTaken.promise, release };
  }

  it('serializes two uses at a balance of 1: the second waits, then gets insufficientCredits', async () => {
    await setBalance(1);
    const { credits, locked, release } = gatedCredits();
    const metering = await build(credits);

    const first = metering.consume(customerId, use('race-1'));

    await locked;
    const second = metering
      .consume(customerId, use('race-2'))
      .catch((error: unknown) => error);

    await untilABackendWaitsOnALock();
    release();

    await expect(first).resolves.toMatchObject({
      debited: true,
      balanceAfter: 0
    });
    await expect(second).resolves.toMatchObject({
      errorKey: ErrorKeys.BILLING.INSUFFICIENT_CREDITS
    });
    expect(await balance()).toBe(0);
    expect(
      await ds.getRepository(UsageRecord).count({ where: { customerId } })
    ).toBe(1);
    expect(
      await ds.getRepository(CreditLedger).count({ where: { customerId } })
    ).toBe(1);
  }, 30_000);

  it('debits once when the same key arrives twice at the same time', async () => {
    await setBalance(5);
    const { credits, locked, release } = gatedCredits();
    const metering = await build(credits);

    const first = metering.consume(customerId, use('same-key'));

    await locked;
    const second = metering.consume(customerId, use('same-key'));

    await untilABackendWaitsOnALock();
    release();

    const [a, b] = await Promise.all([first, second]);

    expect(a).toMatchObject({
      debited: true,
      replayed: false,
      balanceAfter: 4
    });
    expect(b).toEqual({
      recordId: a.recordId,
      debited: true,
      replayed: true,
      balanceAfter: 4
    });
    expect(await balance()).toBe(4);
    expect(
      await ds.getRepository(CreditLedger).count({ where: { customerId } })
    ).toBe(1);
  }, 30_000);

  it('ties the ledger row to its use and emits the crossing once per crossing', async () => {
    await setBalance(2);
    const metering = await build(realCredits());

    const { recordId } = await metering.consume(customerId, use('c-1'));

    expect(emit).not.toHaveBeenCalled();

    await metering.consume(customerId, use('c-2'));
    await metering
      .consume(customerId, use('c-3'))
      .catch((error: unknown) => error);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      CreditBalanceCrossedEvent.name,
      new CreditBalanceCrossedEvent(userId as string)
    );

    const ledger = await ds
      .getRepository(CreditLedger)
      .findOneByOrFail({ customerId, refUsageRecordId: recordId as string });

    expect(ledger).toMatchObject({ reason: 'usage', refInvoiceId: null });
    expect(ledger.delta.toNumber()).toBe(-1);

    const spent = await realCredits().spentOnMetering(customerId, {
      from: new Date(Date.now() - 60_000),
      to: new Date(Date.now() + 60_000)
    });

    expect(spent).toBe(2);
  }, 30_000);
});
