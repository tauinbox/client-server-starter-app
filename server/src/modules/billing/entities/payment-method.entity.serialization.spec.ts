import { instanceToPlain } from 'class-transformer';
import { PaymentMethod } from './payment-method.entity';

function createPaymentMethod(
  overrides: Partial<PaymentMethod> = {}
): PaymentMethod {
  return Object.assign(new PaymentMethod(), {
    id: 'pm-1',
    customerId: 'cus-1',
    provider: 'paddle',
    providerMethodRef: 'pm_secret_ref',
    brand: 'visa',
    last4: '4242',
    isDefault: true,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides
  });
}

describe('PaymentMethod entity serialization', () => {
  it('hides providerMethodRef (tokenised provider reference)', () => {
    const plain = instanceToPlain(createPaymentMethod());
    expect(plain).not.toHaveProperty('providerMethodRef');
  });

  it('keeps the display fields', () => {
    const plain = instanceToPlain(createPaymentMethod());
    expect(plain).toMatchObject({
      brand: 'visa',
      last4: '4242',
      isDefault: true
    });
  });
});
