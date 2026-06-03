import { instanceToPlain } from 'class-transformer';
import { UsageRecord } from './usage-record.entity';

function createUsageRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return Object.assign(new UsageRecord(), {
    id: 'use-1',
    customerId: 'cus-1',
    subscriptionId: 'sub-1',
    meterKey: 'api_calls',
    quantity: 42,
    occurredAt: new Date('2025-01-01T00:00:00Z'),
    idempotencyKey: 'idem_secret_key',
    recordedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides
  });
}

describe('UsageRecord entity serialization', () => {
  it('hides idempotencyKey (internal write-dedup key)', () => {
    const plain = instanceToPlain(createUsageRecord());
    expect(plain).not.toHaveProperty('idempotencyKey');
  });

  it('keeps the public wire fields', () => {
    const plain = instanceToPlain(createUsageRecord());
    expect(plain).toMatchObject({ meterKey: 'api_calls', quantity: 42 });
  });
});
