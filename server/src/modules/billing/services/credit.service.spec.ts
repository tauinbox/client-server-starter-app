import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { CreditBalance } from '../entities/credit-balance.entity';
import { CreditLedger } from '../entities/credit-ledger.entity';
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
  const dataSource = {
    transaction: jest.fn((cb: (m: ManagerMock) => unknown) => cb(manager))
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      CreditService,
      { provide: getRepositoryToken(CreditBalance), useValue: balances },
      { provide: getDataSourceToken(), useValue: dataSource }
    ]
  }).compile();

  return {
    service: moduleRef.get(CreditService),
    balances,
    manager,
    dataSource
  };
}

describe('CreditService', () => {
  describe('reads', () => {
    it('availableUnits returns the positive balance', async () => {
      const { service } = await build({ balanceUnits: 120 });
      await expect(service.availableUnits('cust-1')).resolves.toBe(120);
    });

    it('availableUnits clamps a negative (clawed-back) balance to zero', async () => {
      const { service } = await build({ balanceUnits: -50 });
      await expect(service.availableUnits('cust-1')).resolves.toBe(0);
    });

    it('availableUnits treats a missing balance row as zero', async () => {
      const { service } = await build(null);
      await expect(service.availableUnits('cust-1')).resolves.toBe(0);
    });

    it('isBlocked only when the balance is negative', async () => {
      const { service: negative } = await build({ balanceUnits: -1 });
      await expect(negative.isBlocked('cust-1')).resolves.toBe(true);

      const { service: zero } = await build({ balanceUnits: 0 });
      await expect(zero.isBlocked('cust-1')).resolves.toBe(false);

      const { service: missing } = await build(null);
      await expect(missing.isBlocked('cust-1')).resolves.toBe(false);
    });
  });

  describe('mutations', () => {
    it('addPurchase upserts a positive delta and journals it', async () => {
      const { service, manager } = await build();

      await service.addPurchase(
        manager as unknown as EntityManager,
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
        delta: 500,
        reason: 'purchase',
        refInvoiceId: 'inv-1'
      });
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it('spendOnUsage applies a negative delta with a usage ledger entry', async () => {
      const { service, manager } = await build();

      await service.spendOnUsage(
        manager as unknown as EntityManager,
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
        delta: -42,
        reason: 'usage',
        refInvoiceId: 'inv-2'
      });
    });

    it('clawbackPurchase runs in its own transaction with a refund ledger entry', async () => {
      const { service, manager, dataSource } = await build();

      await service.clawbackPurchase('cust-1', 'inv-1', 500);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.query).toHaveBeenCalledWith(expect.any(String), [
        'cust-1',
        -500
      ]);
      expect(manager.create).toHaveBeenCalledWith(CreditLedger, {
        customerId: 'cust-1',
        delta: -500,
        reason: 'refund',
        refInvoiceId: 'inv-1'
      });
    });
  });
});
