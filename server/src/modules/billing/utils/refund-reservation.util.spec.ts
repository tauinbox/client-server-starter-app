import { Money } from '@app/shared/utils/money';
import { Invoice } from '../entities/invoice.entity';
import {
  lockInvoice,
  releaseRefund,
  remainingRefundable,
  reserveRefund
} from './refund-reservation.util';

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    customerId: 'cust-1',
    subscriptionId: 'sub-1',
    provider: 'yookassa',
    providerEventId: null,
    providerInvoiceRef: 'pay_1',
    amountMinor: Money.fromMinor(99000),
    refundedMinor: Money.fromMinor(0),
    currency: 'RUB',
    status: 'paid',
    billingMode: 'fixed',
    kind: 'subscription',
    productId: null,
    periodStart: new Date(),
    periodEnd: new Date(),
    paidAt: new Date(),
    receiptRef: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  } as Invoice;
}

/** Partial EntityManager: the util only reads through findOne and writes through save. */
function makeManager(stored: Invoice | null) {
  return {
    findOne: jest.fn().mockResolvedValue(stored),
    save: jest.fn((_target: unknown, entity: Invoice) =>
      Promise.resolve(entity)
    )
  };
}

describe('lockInvoice', () => {
  it('takes a pessimistic write lock on top of the caller options', async () => {
    const manager = makeManager(makeInvoice());

    // @ts-expect-error - partial EntityManager mock: uses findOne/save
    await lockInvoice(manager, {
      where: { subscriptionId: 'sub-1' },
      order: { createdAt: 'DESC' }
    });

    expect(manager.findOne).toHaveBeenCalledWith(Invoice, {
      where: { subscriptionId: 'sub-1' },
      order: { createdAt: 'DESC' },
      lock: { mode: 'pessimistic_write' }
    });
  });
});

describe('remainingRefundable', () => {
  it('is the paid amount less what is already refunded', () => {
    const invoice = makeInvoice({
      amountMinor: Money.fromMinor(99000),
      refundedMinor: Money.fromMinor(49000)
    });

    expect(remainingRefundable(invoice).toMinorString()).toBe('50000');
  });
});

describe('reserveRefund', () => {
  it('reserves the full request when the remainder covers it', async () => {
    const invoice = makeInvoice({ refundedMinor: Money.fromMinor(9000) });
    const manager = makeManager(invoice);

    const { reserved, cumulative } = await reserveRefund(
      // @ts-expect-error - partial EntityManager mock: uses findOne/save
      manager,
      invoice,
      Money.fromMinor(30000)
    );

    expect(reserved.toMinorString()).toBe('30000');
    expect(cumulative.toMinorString()).toBe('39000');
    expect(invoice.refundedMinor.toMinorString()).toBe('39000');
    expect(manager.save).toHaveBeenCalledWith(Invoice, invoice);
  });

  it('caps a request larger than the remainder instead of over-reserving', async () => {
    const invoice = makeInvoice({
      amountMinor: Money.fromMinor(99000),
      refundedMinor: Money.fromMinor(80000)
    });
    const manager = makeManager(invoice);

    const { reserved, cumulative } = await reserveRefund(
      // @ts-expect-error - partial EntityManager mock: uses findOne/save
      manager,
      invoice,
      Money.fromMinor(30000)
    );

    expect(reserved.toMinorString()).toBe('19000');
    expect(cumulative.toMinorString()).toBe('99000');
    expect(invoice.refundedMinor.toMinorString()).toBe('99000');
  });

  it('reserves nothing and writes nothing on a fully refunded invoice', async () => {
    const invoice = makeInvoice({
      amountMinor: Money.fromMinor(99000),
      refundedMinor: Money.fromMinor(99000)
    });
    const manager = makeManager(invoice);

    const { reserved, cumulative } = await reserveRefund(
      // @ts-expect-error - partial EntityManager mock: uses findOne/save
      manager,
      invoice,
      Money.fromMinor(1000)
    );

    expect(reserved.toMinorString()).toBe('0');
    expect(cumulative.toMinorString()).toBe('99000');
    expect(manager.save).not.toHaveBeenCalled();
  });
});

describe('releaseRefund', () => {
  it('subtracts the released leg under the lock', async () => {
    const invoice = makeInvoice({ refundedMinor: Money.fromMinor(49000) });
    const manager = makeManager(invoice);

    // @ts-expect-error - partial EntityManager mock: uses findOne/save
    const saved = await releaseRefund(manager, 'inv-1', Money.fromMinor(9000));

    expect(saved?.refundedMinor.toMinorString()).toBe('40000');
    expect(manager.findOne).toHaveBeenCalledWith(Invoice, {
      where: { id: 'inv-1' },
      lock: { mode: 'pessimistic_write' }
    });
    expect(manager.save).toHaveBeenCalledWith(Invoice, invoice);
  });

  it('clamps at zero when more is released than was reserved', async () => {
    const invoice = makeInvoice({ refundedMinor: Money.fromMinor(1000) });
    const manager = makeManager(invoice);

    // @ts-expect-error - partial EntityManager mock: uses findOne/save
    const saved = await releaseRefund(manager, 'inv-1', Money.fromMinor(5000));

    expect(saved?.refundedMinor.toMinorString()).toBe('0');
  });

  it('is a no-op when the invoice is gone', async () => {
    const manager = makeManager(null);

    // @ts-expect-error - partial EntityManager mock: uses findOne/save
    const saved = await releaseRefund(manager, 'inv-1', Money.fromMinor(5000));

    expect(saved).toBeNull();
    expect(manager.save).not.toHaveBeenCalled();
  });
});
