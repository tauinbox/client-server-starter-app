import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { ErrorKeys } from '@app/shared/constants';
import { BillingService } from './billing.service';
import { BillingConfigService } from './config/billing-config.service';
import { FeatureFlagResolverService } from '../feature-flags/services/feature-flag-resolver.service';
import { BILLING_PROVIDERS } from './providers/payment-provider.interface';
import type { Customer } from './entities/customer.entity';

const paddle = { id: 'paddle' };
const yookassa = { id: 'yookassa' };

type Args = Pick<Customer, 'providerOverride' | 'country' | 'userId'>;

const USER_ID = 'user-1';

describe('BillingService.resolveProvider', () => {
  let service: BillingService;
  let featureFlags: { isEnabledForUserId: jest.Mock };
  let billingConfig: { isConfigured: jest.Mock };

  // Default kill-switch state: both provider flags enabled. Per-test overrides
  // replace this map.
  const enabledByKey: Record<string, boolean> = {
    'billing-paddle': true,
    'billing-yookassa': true
  };

  beforeEach(async () => {
    featureFlags = {
      isEnabledForUserId: jest.fn((_userId: string, key: string) =>
        Promise.resolve(enabledByKey[key] ?? false)
      )
    };
    billingConfig = { isConfigured: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: BILLING_PROVIDERS, useValue: [paddle, yookassa] },
        { provide: FeatureFlagResolverService, useValue: featureFlags },
        { provide: BillingConfigService, useValue: billingConfig }
      ]
    }).compile();

    service = module.get(BillingService);
  });

  const args = (over: Partial<Args> = {}): Args => ({
    providerOverride: null,
    country: 'US',
    userId: USER_ID,
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
    featureFlags.isEnabledForUserId.mockImplementation(
      (_userId: string, key: string) =>
        Promise.resolve(key !== 'billing-paddle')
    );
    const refusal = service.resolveProvider(args({ country: 'US' }));

    await expect(refusal).rejects.toThrow(ServiceUnavailableException);
    await expect(refusal).rejects.toMatchObject({
      response: { errorKey: ErrorKeys.BILLING.PROVIDER_UNAVAILABLE }
    });
  });

  it('throws 503 when the resolved provider is not configured', async () => {
    billingConfig.isConfigured.mockReturnValue(false);
    await expect(
      service.resolveProvider(args({ country: 'RU' }))
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws 503 when the resolved provider is not registered', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: BILLING_PROVIDERS, useValue: [yookassa] },
        { provide: FeatureFlagResolverService, useValue: featureFlags },
        { provide: BillingConfigService, useValue: billingConfig }
      ]
    }).compile();
    const refusal = module
      .get(BillingService)
      .resolveProvider(args({ country: 'US' }));

    await expect(refusal).rejects.toThrow(ServiceUnavailableException);
    await expect(refusal).rejects.toMatchObject({
      response: { errorKey: ErrorKeys.BILLING.PROVIDER_UNAVAILABLE }
    });
  });

  it('evaluates only the resolved provider flag, for the customer user', async () => {
    await service.resolveProvider(args({ country: 'US' }));
    expect(featureFlags.isEnabledForUserId).toHaveBeenCalledTimes(1);
    expect(featureFlags.isEnabledForUserId).toHaveBeenCalledWith(
      USER_ID,
      'billing-paddle'
    );
  });
});

describe('BillingService.isProviderAvailable', () => {
  let featureFlags: { isEnabledForUserId: jest.Mock };
  let billingConfig: { isConfigured: jest.Mock };

  const build = async (registered = [paddle, yookassa]) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: BILLING_PROVIDERS, useValue: registered },
        { provide: FeatureFlagResolverService, useValue: featureFlags },
        { provide: BillingConfigService, useValue: billingConfig }
      ]
    }).compile();
    return module.get(BillingService);
  };

  beforeEach(() => {
    featureFlags = {
      isEnabledForUserId: jest.fn().mockResolvedValue(true)
    };
    billingConfig = { isConfigured: jest.fn().mockReturnValue(true) };
  });

  it('is true for an enabled, configured and registered provider', async () => {
    const service = await build();
    await expect(service.isProviderAvailable('paddle', USER_ID)).resolves.toBe(
      true
    );
    expect(featureFlags.isEnabledForUserId).toHaveBeenCalledWith(
      USER_ID,
      'billing-paddle'
    );
  });

  it('is false when the kill-switch flag evaluates to false', async () => {
    featureFlags.isEnabledForUserId.mockResolvedValue(false);
    const service = await build();
    await expect(service.isProviderAvailable('paddle', USER_ID)).resolves.toBe(
      false
    );
  });

  it('is false when the provider is not configured', async () => {
    billingConfig.isConfigured.mockImplementation(
      (id: string) => id !== 'paddle'
    );
    const service = await build();
    await expect(service.isProviderAvailable('paddle', USER_ID)).resolves.toBe(
      false
    );
    await expect(
      service.isProviderAvailable('yookassa', USER_ID)
    ).resolves.toBe(true);
  });

  it('is false when the provider is not registered', async () => {
    const service = await build([yookassa]);
    await expect(service.isProviderAvailable('paddle', USER_ID)).resolves.toBe(
      false
    );
  });
});

describe('BillingService.getProviderById', () => {
  const build = async (registered = [paddle, yookassa]) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: BILLING_PROVIDERS, useValue: registered },
        {
          provide: FeatureFlagResolverService,
          useValue: { isEnabledForUserId: jest.fn() }
        },
        { provide: BillingConfigService, useValue: { isConfigured: jest.fn() } }
      ]
    }).compile();
    return module.get(BillingService);
  };

  it('returns the registered provider without an availability check', async () => {
    const service = await build();
    expect(service.getProviderById('yookassa')).toBe(yookassa);
  });

  it('throws 503 when the provider is not registered', async () => {
    const service = await build([yookassa]);

    let refusal: unknown;
    try {
      service.getProviderById('paddle');
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ServiceUnavailableException);
    expect(refusal).toMatchObject({
      response: { errorKey: ErrorKeys.BILLING.PROVIDER_UNAVAILABLE }
    });
  });
});
