import type { Server } from 'http';
import {
  BILLING_CONFIGURED_ATTRIBUTE,
  BILLING_PROVIDER_FLAGS,
  OAUTH_PROVIDER_FLAGS
} from '@app/shared/constants';
import type { FeatureFlagAttributeKeysResponse } from '@app/shared/types';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  resetState();
  const app = createApp();
  server = await listenOnUnblockedPort(app);
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

async function login(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function getAttributeKeys(token?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/admin/feature-flags/attribute-keys`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
}

describe('GET /admin/feature-flags/attribute-keys', () => {
  it('reports every registered custom key, sorted', async () => {
    const res = await getAttributeKeys(await login('admin@example.com'));
    expect(res.status).toBe(200);

    const body = (await res.json()) as FeatureFlagAttributeKeysResponse;
    const expected = [
      ...OAUTH_PROVIDER_FLAGS.map((p) => p.attributeKey),
      ...BILLING_PROVIDER_FLAGS.map((p) => p.configuredAttribute),
      BILLING_CONFIGURED_ATTRIBUTE
    ].sort();

    expect(body.customKeys).toEqual(expected);
  });

  it('does not report the built-in fields, which are offered as `field` options', async () => {
    const res = await getAttributeKeys(await login('admin@example.com'));
    const body = (await res.json()) as FeatureFlagAttributeKeysResponse;

    expect(body.customKeys).not.toContain('email');
    expect(body.customKeys).not.toContain('emailDomain');
    expect(body.customKeys).not.toContain('createdAt');
  });

  // The literal segment must be declared above the /:id handler, or the UUID
  // guard answers this request with a 400 instead.
  it('is not swallowed by the :id route', async () => {
    const res = await getAttributeKeys(await login('admin@example.com'));
    expect(res.status).toBe(200);
  });

  it('rejects a caller without the feature-flag permission', async () => {
    const res = await getAttributeKeys(await login('user@example.com'));
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated caller', async () => {
    const res = await getAttributeKeys();
    expect(res.status).toBe(401);
  });
});
