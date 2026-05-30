import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AttributeRegistryService } from '../../feature-flags/services/attribute-registry.service';
import { OAuthProviderFlagAttributesRegistrar } from './oauth-provider-flag-attributes.registrar';

describe('OAuthProviderFlagAttributesRegistrar', () => {
  const fakeReq = {} as Request;

  function setup(env: Record<string, unknown>): AttributeRegistryService {
    const registry = new AttributeRegistryService();
    const config = new ConfigService(env);
    new OAuthProviderFlagAttributesRegistrar(config, registry).onModuleInit();
    return registry;
  }

  it('registers each provider attribute as a known custom key', () => {
    const registry = setup({});
    const customKeys = registry.getKnownCustomKeys();
    expect(customKeys.has('oauthGoogleConfigured')).toBe(true);
    expect(customKeys.has('oauthFacebookConfigured')).toBe(true);
    expect(customKeys.has('oauthVkConfigured')).toBe(true);
  });

  it('resolves true only for providers whose *_CLIENT_ID env var is set', () => {
    const registry = setup({ GOOGLE_CLIENT_ID: 'google-id' });
    const out = registry.resolveAll(null, fakeReq);
    expect(out['oauthGoogleConfigured']).toBe(true);
    expect(out['oauthFacebookConfigured']).toBe(false);
    expect(out['oauthVkConfigured']).toBe(false);
  });

  it('treats an empty-string env var as not configured', () => {
    const registry = setup({ GOOGLE_CLIENT_ID: '', VK_CLIENT_ID: 'vk-id' });
    const out = registry.resolveAll(null, fakeReq);
    expect(out['oauthGoogleConfigured']).toBe(false);
    expect(out['oauthVkConfigured']).toBe(true);
  });
});
