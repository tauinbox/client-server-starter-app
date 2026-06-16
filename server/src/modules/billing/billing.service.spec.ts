import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingConfigService } from './config/billing-config.service';
import { FeatureFlagService } from '../feature-flags/services/feature-flag.service';
import { BILLING_PROVIDERS } from './providers/payment-provider.interface';
import type { Customer } from './entities/customer.entity';

const paddle = { id: 'paddle' };
const yookassa = { id: 'yookassa' };

type Args = Pick<Customer, 'providerOverride' | 'country'>;

describe('BillingService.resolveProvider', () => {
  let service: BillingService;
  let featureFlags: { findByKey: jest.Mock };
  let billingConfig: { isConfigured: jest.Mock };

  // Default kill-switch state: both provider flags enabled. Per-test overrides
  // replace this map.
  const enabledByKey: Record<string, boolean> = {
    'billing.provider.paddle.enabled': true,
    'billing.provider.yookassa.enabled': true
  };

  beforeEach(async () => {
    featureFlags = {
      findByKey: jest.fn((key: string) =>
        Promise.resolve(
          key in enabledByKey ? { key, enabled: enabledByKey[key] } : null
        )
      )
    };
    billingConfig = { isConfigured: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: BILLING_PROVIDERS, useValue: [paddle, yookassa] },
        { provide: FeatureFlagService, useValue: featureFlags },
        { provide: BillingConfigService, useValue: billingConfig }
      ]
    }).compile();

    service = module.get(BillingService);
  });

  const args = (over: Partial<Args> = {}): Args => ({
    providerOverride: null,
    country: 'US',
    ...over
  });

  it('routes a Russian customer to YooKassa', async () => {
    const provider = await service.resolveProvider(args({ country: 'RU' }));
    expect(provider.id).toBe('yookassa');
  });

  it('routes a rest-of-world customer to Paddle', async () => {
    const provider = await service.resolveProvider(args({ country: 'US' }));
    expect(provider.id).toBe('paddle');
  });

  it('lets a manual override win over the geo default', async () => {
    const provider = await service.resolveProvider(
      args({ country: 'US', providerOverride: 'yookassa' })
    );
    expect(provider.id).toBe('yookassa');
  });

  it('throws 503 when the resolved provider is disabled', async () => {
    featureFlags.findByKey.mockImplementation((key: string) =>
      Promise.resolve({
        key,
        enabled: key !== 'billing.provider.paddle.enabled'
      })
    );
    await expect(
      service.resolveProvider(args({ country: 'US' }))
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws 503 when the resolved provider is not configured', async () => {
    billingConfig.isConfigured.mockReturnValue(false);
    await expect(
      service.resolveProvider(args({ country: 'RU' }))
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('treats an absent kill-switch flag as disabled (fail closed)', async () => {
    featureFlags.findByKey.mockResolvedValue(null);
    await expect(
      service.resolveProvider(args({ country: 'US' }))
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('looks up only the resolved provider flag, not the whole flag set', async () => {
    await service.resolveProvider(args({ country: 'US' }));
    expect(featureFlags.findByKey).toHaveBeenCalledTimes(1);
    expect(featureFlags.findByKey).toHaveBeenCalledWith(
      'billing.provider.paddle.enabled'
    );
  });
});
