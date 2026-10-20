import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, IsNull } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import { CreditBalance } from '../entities/credit-balance.entity';
import { CreditLedger } from '../entities/credit-ledger.entity';
import { Invoice } from '../entities/invoice.entity';
import { CreditService } from './credit.service';

type ManagerMock = {
  query: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
};

function makeManager(): ManagerMock {
  return {
    query: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn((entity: object) => Promise.resolve(entity))
  };
}

async function build(balance: Partial<CreditBalance> | null = null) {
  const balances = {
    findOne: jest.fn().mockResolvedValue(balance)
  };
  const manager = makeManager();

  const moduleRef = await Test.createTestingModule({
    providers: [
      CreditService,
      { provide: getRepositoryToken(CreditBalance), useValue: balances }
    ]
  }).compile();

  return {
    service: moduleRef.get(CreditService),
    balances,
    manager
  };
}

describe('CreditService', () => {
  describe('reads', () => {
    function readManager(balance: Partial<CreditBalance> | null, held = '0') {
      const qb: Record<
        'select' | 'where' | 'andWhere' | 'getRawOne',
        jest.Mock
      > = {
        select: jest.fn(() => qb),
        where: jest.fn(() => qb),
        andWhere: jest.fn(() => qb),
        getRawOne: jest.fn().mockResolvedValue({ held })
      };
      return {
        findOne: jest.fn().mockResolvedValue(balance),
        createQueryBuilder: jest.fn(() => qb),
        qb
      };
    }

    it('availableUnitsForUpdate locks the balance row and subtracts the units unpaid invoices hold', async () => {
      const { service } = await build();
      const manager = readManager({ balanceUnits: Money.fromMinor(120) }, '30');

      await expect(
        // @ts-expect-error - partial EntityManager mock: uses findOne/createQueryBuilder
        service.availableUnitsForUpdate(manager, 'cust-1')
      ).resolves.toBe(90);
      expect(manager.findOne).toHaveBeenCalledWith(CreditBalance, {
        where: { customerId: 'cust-1' },
        lock: { mode: 'pessimistic_write' }
      });
      expect(manager.qb.andWhere).toHaveBeenCalledWith(
        'i.status IN (:...statuses)',
        { statuses: ['pending', 'failed'] }
      );
      expect(manager.qb.andWhere).toHaveBeenCalledWith(
        'i.creditsReleasedAt IS NULL'
      );
    });

    it('availableUnitsForUpdate leaves the re-rated invoice out of its own hold', async () => {
      const { service } = await build();
      const manager = readManager({ balanceUnits: Money.fromMinor(120) });

      // @ts-expect-error - partial EntityManager mock: uses findOne/createQueryBuilder
      await service.availableUnitsForUpdate(manager, 'cust-1', 'inv-1');

      expect(manager.qb.andWhere).toHaveBeenCalledWith(
        'i.id <> :excludeInvoiceId',
        { excludeInvoiceId: 'inv-1' }
      );
    });

    it('availableUnitsForUpdate offers nothing when the holds take the whole balance', async () => {
      const { service } = await build();
      const manager = readManager({ balanceUnits: Money.fromMinor(20) }, '30');

      await expect(
        // @ts-expect-error - partial EntityManager mock: uses findOne/createQueryBuilder
        service.availableUnitsForUpdate(manager, 'cust-1')
      ).resolves.toBe(0);
    });

    it.each([
      [
        'a negative (clawed-back) balance',
        { balanceUnits: Money.fromMinor(-50) }
      ],
      ['a missing balance row', null]
    ])(
      'availableUnitsForUpdate offers nothing for %s',
      async (_name, balance) => {
        const { service } = await build();
        const manager = readManager(balance);

        await expect(
          // @ts-expect-error - partial EntityManager mock: uses findOne/createQueryBuilder
          service.availableUnitsForUpdate(manager, 'cust-1')
        ).resolves.toBe(0);
        expect(manager.createQueryBuilder).not.toHaveBeenCalled();
      }
    );

    it('isBlocked only when the balance is negative', async () => {
      const { service: negative } = await build({
        balanceUnits: Money.fromMinor(-1)
      });
      await expect(negative.isBlocked('cust-1')).resolves.toBe(true);

      const { service: zero } = await build({
        balanceUnits: Money.fromMinor(0)
      });
      await expect(zero.isBlocked('cust-1')).resolves.toBe(false);

      const { service: missing } = await build(null);
      await expect(missing.isBlocked('cust-1')).resolves.toBe(false);
    });
  });

  describe('mutations', () => {
    it('addPurchase upserts a positive delta and journals it', async () => {
      const { service, manager } = await build();

      await service.addPurchase(
        // @ts-expect-error - partial EntityManager mock: uses query/create/save
        manager,
        'cust-1',
        'inv-1',
        500
      );

      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT ("customer_id") DO UPDATE'),
        ['cust-1', 500]
      );
      expect(manager.create).toHaveBeenCalledWith(CreditLedger, {
        customerId: 'cust-1',
        delta: Money.fromMinor(500),
        reason: 'purchase',
        refInvoiceId: 'inv-1'
      });
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it('spendOnUsage applies a negative delta with a usage ledger entry', async () => {
      const { service, manager } = await build();

      await service.spendOnUsage(
        // @ts-expect-error - partial EntityManager mock: uses query/create/save
        manager,
        'cust-1',
        'inv-2',
        42
      );

      expect(manager.query).toHaveBeenCalledWith(expect.any(String), [
        'cust-1',
        -42
      ]);
      expect(manager.create).toHaveBeenCalledWith(CreditLedger, {
        customerId: 'cust-1',
        delta: Money.fromMinor(-42),
        reason: 'usage',
        refInvoiceId: 'inv-2'
      });
    });

    it('clawbackPurchase applies a refund delta on the caller transaction manager', async () => {
      const { service, manager } = await build();

      await service.clawbackPurchase(
        // @ts-expect-error - partial EntityManager mock: uses query/create/save
        manager,
        'cust-1',
        'inv-1',
        500
      );

      expect(manager.query).toHaveBeenCalledWith(expect.any(String), [
        'cust-1',
        -500
      ]);
      expect(manager.create).toHaveBeenCalledWith(CreditLedger, {
        customerId: 'cust-1',
        delta: Money.fromMinor(-500),
        reason: 'refund',
        refInvoiceId: 'inv-1'
      });
    });

    it('releaseHolds ends the hold of the unpaid invoices that match', async () => {
      const { service } = await build();
      const manager = { update: jest.fn().mockResolvedValue({ affected: 2 }) };

      // @ts-expect-error - partial EntityManager mock: uses update
      await service.releaseHolds(manager, { subscriptionId: 'sub-1' });

      expect(manager.update).toHaveBeenCalledWith(
        Invoice,
        {
          subscriptionId: 'sub-1',
          status: In(['pending', 'failed']),
          creditsReleasedAt: IsNull()
        },
        { creditsReleasedAt: expect.any(Function) as unknown }
      );
    });
  });
});
