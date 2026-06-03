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
  let featureFlags: { findAll: jest.Mock };
  let billingConfig: { isConfigured: jest.Mock };

  beforeEach(async () => {
    // Both kill-switch flags enabled by default; per-test overrides below.
    featureFlags = {
      findAll: jest.fn().mockResolvedValue([
        { key: 'billing.provider.paddle.enabled', enabled: true },
        { key: 'billing.provider.yookassa.enabled', enabled: true }
      ])
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
    featureFlags.findAll.mockResolvedValue([
      { key: 'billing.provider.paddle.enabled', enabled: false },
      { key: 'billing.provider.yookassa.enabled', enabled: true }
    ]);
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
    featureFlags.findAll.mockResolvedValue([]);
    await expect(
      service.resolveProvider(args({ country: 'US' }))
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
