import { instanceToPlain } from 'class-transformer';
import { Invoice } from './invoice.entity';

function createInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return Object.assign(new Invoice(), {
    id: 'inv-1',
    customerId: 'cus-1',
    subscriptionId: 'sub-1',
    provider: 'paddle',
    providerEventId: 'evt_secret_ref',
    providerInvoiceRef: 'txn_public_ref',
    amountMinor: 1200,
    currency: 'USD',
    status: 'paid',
    billingMode: 'fixed',
    periodStart: new Date('2025-01-01T00:00:00Z'),
    periodEnd: new Date('2025-02-01T00:00:00Z'),
    paidAt: new Date('2025-01-01T00:00:00Z'),
    receiptRef: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides
  });
}

describe('Invoice entity serialization', () => {
  it('hides providerEventId (webhook idempotency reference)', () => {
    const plain = instanceToPlain(createInvoice());
    expect(plain).not.toHaveProperty('providerEventId');
  });

  it('keeps the public invoice reference and amount', () => {
    const plain = instanceToPlain(createInvoice());
    expect(plain).toMatchObject({
      providerInvoiceRef: 'txn_public_ref',
      amountMinor: 1200,
      status: 'paid'
    });
  });
});
