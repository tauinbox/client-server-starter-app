import { expect } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Money } from '@app/shared/utils/money';
import { CreditBalance } from '../entities/credit-balance.entity';
import { CreditLedger } from '../entities/credit-ledger.entity';
import { CreditService, crossesZero } from './credit.service';

type ManagerMock = {
  query: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
};

function makeManager(): ManagerMock {
  return {
    query: jest.fn().mockResolvedValue([{ balance_units: '100' }]),
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
    function readManager(balance: Partial<CreditBalance> | null) {
      return { findOne: jest.fn().mockResolvedValue(balance) };
    }

    it.each([
      ['a positive balance', { balanceUnits: Money.fromMinor(7) }, 7],
      ['a clawed-back debt', { balanceUnits: Money.fromMinor(-3) }, -3],
      ['a missing balance row', null, 0]
    ])(
      'lockedBalance reads %s under a row lock',
      async (_name, balance, expected) => {
        const { service } = await build();
        const manager = readManager(balance);

        await expect(
          // @ts-expect-error - partial EntityManager mock: uses findOne
          service.lockedBalance(manager, 'cust-1')
        ).resolves.toBe(expected);
        expect(manager.findOne).toHaveBeenCalledWith(CreditBalance, {
          where: { customerId: 'cust-1' },
          lock: { mode: 'pessimistic_write' }
        });
      }
    );
  });

  describe('crossesZero', () => {
    it.each([
      [{ before: 0, after: 500 }, true],
      [{ before: 1, after: 0 }, true],
      [{ before: 100, after: -400 }, true],
      [{ before: -50, after: 450 }, true],
      [{ before: 10, after: 5 }, false],
      [{ before: -50, after: -10 }, false],
      [{ before: 0, after: 0 }, false]
    ])('%o crosses zero: %s', (change, expected) => {
      expect(crossesZero(change)).toBe(expected);
    });
  });

  describe('mutations', () => {
    it('addPurchase upserts a positive delta and journals it', async () => {
      const { service, manager } = await build();

      manager.query.mockResolvedValueOnce([{ balance_units: '500' }]);

      await expect(
        service.addPurchase(
          // @ts-expect-error - partial EntityManager mock: uses query/create/save
          manager,
          { customerId: 'cust-1', invoiceId: 'inv-1' },
          500
        )
      ).resolves.toEqual({ before: 0, after: 500 });

      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT ("customer_id") DO UPDATE'),
        ['cust-1', 500]
      );
      expect(manager.create).toHaveBeenCalledWith(CreditLedger, {
        customerId: 'cust-1',
        delta: Money.fromMinor(500),
        reason: 'purchase',
        refInvoiceId: 'inv-1',
        refUsageRecordId: null
      });
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it('spendOnMetering ties the debit to its usage record', async () => {
      const { service, manager } = await build();

      manager.query.mockResolvedValueOnce([{ balance_units: '0' }]);

      await expect(
        service.spendOnMetering(
          // @ts-expect-error - partial EntityManager mock: uses query/create/save
          manager,
          { customerId: 'cust-1', usageRecordId: 'use-1' },
          3
        )
      ).resolves.toEqual({ before: 3, after: 0 });

      expect(manager.query).toHaveBeenCalledWith(expect.any(String), [
        'cust-1',
        -3
      ]);
      expect(manager.create).toHaveBeenCalledWith(CreditLedger, {
        customerId: 'cust-1',
        delta: Money.fromMinor(-3),
        reason: 'usage',
        refInvoiceId: null,
        refUsageRecordId: 'use-1'
      });
    });

    it('clawbackPurchase applies a refund delta on the caller transaction manager', async () => {
      const { service, manager } = await build();

      await service.clawbackPurchase(
        // @ts-expect-error - partial EntityManager mock: uses query/create/save
        manager,
        { customerId: 'cust-1', invoiceId: 'inv-1' },
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
        refInvoiceId: 'inv-1',
        refUsageRecordId: null
      });
    });
  });
});
