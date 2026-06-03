import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AttributeRegistryService } from '../../feature-flags/services/attribute-registry.service';
import { BillingConfigService } from '../config/billing-config.service';
import { BillingConfiguredAttributesRegistrar } from './billing-configured-attributes.registrar';

describe('BillingConfiguredAttributesRegistrar', () => {
  const fakeReq = {} as Request;

  function setup(env: Record<string, unknown>): AttributeRegistryService {
    const registry = new AttributeRegistryService();
    const config = new ConfigService(env);
    new BillingConfiguredAttributesRegistrar(
      new BillingConfigService(config),
      registry
    ).onModuleInit();
    return registry;
  }

  it('registers per-provider and combined attributes as known custom keys', () => {
    const customKeys = setup({}).getKnownCustomKeys();
    expect(customKeys.has('paddleConfigured')).toBe(true);
    expect(customKeys.has('yookassaConfigured')).toBe(true);
    expect(customKeys.has('billingConfigured')).toBe(true);
  });

  it('marks a provider configured only when BOTH of its vars are set', () => {
    const out = setup({ PADDLE_API_KEY: 'k' }).resolveAll(null, fakeReq);
    expect(out['paddleConfigured']).toBe(false);

    const out2 = setup({
      PADDLE_API_KEY: 'k',
      PADDLE_WEBHOOK_SECRET: 's'
    }).resolveAll(null, fakeReq);
    expect(out2['paddleConfigured']).toBe(true);
  });

  it('billingConfigured is true when any provider is configured', () => {
    const out = setup({
      YOOKASSA_SHOP_ID: 'id',
      YOOKASSA_SECRET_KEY: 'sec'
    }).resolveAll(null, fakeReq);
    expect(out['paddleConfigured']).toBe(false);
    expect(out['yookassaConfigured']).toBe(true);
    expect(out['billingConfigured']).toBe(true);
  });

  it('billingConfigured is false when no provider is configured', () => {
    const out = setup({}).resolveAll(null, fakeReq);
    expect(out['billingConfigured']).toBe(false);
  });

  it('treats empty-string credentials as not configured', () => {
    const out = setup({
      PADDLE_API_KEY: '',
      PADDLE_WEBHOOK_SECRET: ''
    }).resolveAll(null, fakeReq);
    expect(out['paddleConfigured']).toBe(false);
    expect(out['billingConfigured']).toBe(false);
  });
});
