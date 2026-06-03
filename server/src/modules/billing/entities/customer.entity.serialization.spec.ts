import { instanceToPlain } from 'class-transformer';
import { Customer } from './customer.entity';

function createCustomer(overrides: Partial<Customer> = {}): Customer {
  return Object.assign(new Customer(), {
    id: 'cus-1',
    userId: 'user-1',
    provider: 'paddle',
    providerOverride: null,
    providerCustomerId: 'ctm_internal',
    country: 'US',
    currency: 'USD',
    defaultPaymentMethodId: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides
  });
}

describe('Customer entity serialization', () => {
  it('hides providerCustomerId (internal provider reference)', () => {
    const plain = instanceToPlain(createCustomer());
    expect(plain).not.toHaveProperty('providerCustomerId');
  });

  it('keeps the public wire fields', () => {
    const plain = instanceToPlain(createCustomer());
    expect(plain).toMatchObject({
      id: 'cus-1',
      userId: 'user-1',
      provider: 'paddle',
      providerOverride: null
    });
  });
});
