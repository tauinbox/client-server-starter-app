import { instanceToPlain } from 'class-transformer';
import { Subscription } from './subscription.entity';

function createSubscription(
  overrides: Partial<Subscription> = {}
): Subscription {
  return Object.assign(new Subscription(), {
    id: 'sub-1',
    customerId: 'cus-1',
    planKey: 'pro',
    provider: 'paddle',
    billingMode: 'fixed',
    status: 'active',
    lifecycleOwner: 'provider',
    currentPeriodStart: new Date('2025-01-01T00:00:00Z'),
    currentPeriodEnd: new Date('2025-02-01T00:00:00Z'),
    cancelAtPeriodEnd: false,
    trialEnd: null,
    providerSubscriptionId: 'sub_secret_ref',
    paymentMethodId: null,
    dunningAttempts: 0,
    nextRenewalAttemptAt: null,
    version: 1,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides
  });
}

describe('Subscription entity serialization', () => {
  it('hides providerSubscriptionId (provider reference)', () => {
    const plain = instanceToPlain(createSubscription());
    expect(plain).not.toHaveProperty('providerSubscriptionId');
  });

  it('hides internal dunning state', () => {
    const plain = instanceToPlain(createSubscription());
    expect(plain).not.toHaveProperty('dunningAttempts');
    expect(plain).not.toHaveProperty('nextRenewalAttemptAt');
  });

  it('hides the concurrency token', () => {
    const plain = instanceToPlain(createSubscription());
    expect(plain).not.toHaveProperty('version');
  });

  it('keeps the public wire fields', () => {
    const plain = instanceToPlain(createSubscription());
    expect(plain).toMatchObject({ planKey: 'pro', status: 'active' });
  });
});
