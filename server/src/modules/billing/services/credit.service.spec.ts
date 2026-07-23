import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Money } from '@app/shared/utils/money';
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
    it('availableUnits returns the positive balance', async () => {
      const { service } = await build({ balanceUnits: Money.fromMinor(120) });
      await expect(service.availableUnits('cust-1')).resolves.toBe(120);
    });

    it('availableUnits clamps a negative (clawed-back) balance to zero', async () => {
      const { service } = await build({ balanceUnits: Money.fromMinor(-50) });
      await expect(service.availableUnits('cust-1')).resolves.toBe(0);
    });

    it('availableUnits treats a missing balance row as zero', async () => {
      const { service } = await build(null);
      await expect(service.availableUnits('cust-1')).resolves.toBe(0);
    });

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
  });
});
