import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import type { FeatureFlagRulePayload } from '@app/shared/types';
import { percentageBucket } from '@app/shared/utils/feature-flag-evaluator';
import { getState, resetState } from '../state';

// Mirrors server/test/feature-flags.e2e-spec.ts: the one-year rollout id is
// issued by GET /feature-flags only when a public percentage rule reads it.
let server: Server;
let baseUrl: string;

const VALID_ANON_ID = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
const UUID_COOKIE =
  /^nxs_anon_id=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12};/;

beforeAll(async () => {
  resetState();
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetState();
});

function addPublicPercentageFlag(): void {
  addPercentageFlag({ public: true }, { type: 'percentage', percent: 100 });
}

function addPercentageFlag(
  flag: { public: boolean },
  payload: FeatureFlagRulePayload
): void {
  const state = getState();
  const now = new Date().toISOString();
  state.featureFlags.set('flag-public-rollout', {
    id: 'flag-public-rollout',
    key: 'public-rollout',
    description: null,
    enabled: true,
    environments: [],
    public: flag.public,
    version: 1,
    updatedByUserId: null,
    createdAt: now,
    updatedAt: now
  });
  state.featureFlagRules.push({
    id: 'rule-public-rollout',
    flagId: 'flag-public-rollout',
    type: 'percentage',
    effect: 'include',
    payload,
    createdAt: now,
    updatedAt: now
  });
}

function getFlags(cookie?: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/feature-flags`, {
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` })
    }
  });
}

async function loginAsUser(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.com', password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

describe('anonymous rollout id issuance', () => {
  it('sets no cookie on a route that is not /feature-flags', async () => {
    const res = await fetch(`${baseUrl}/api/health/live`);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('sets no cookie while no public flag has a percentage rule', async () => {
    const res = await getFlags();
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('issues a UUID and buckets with it once a public percentage flag exists', async () => {
    addPublicPercentageFlag();
    const res = await getFlags();
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(UUID_COOKIE);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    const body = (await res.json()) as { flags: Record<string, boolean> };
    expect(body.flags['public-rollout']).toBe(true);
  });

  it('keeps a valid cookie without re-issuing it', async () => {
    addPublicPercentageFlag();
    const res = await getFlags(`nxs_anon_id=${VALID_ANON_ID}`);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('replaces a cookie that is not a UUID when an id is needed', async () => {
    addPublicPercentageFlag();
    const res = await getFlags(`nxs_anon_id=${'x'.repeat(3000)}`);
    expect(res.headers.get('set-cookie') ?? '').toMatch(UUID_COOKIE);
  });

  it('ignores a cookie that is not a UUID when no id is needed', async () => {
    const res = await getFlags('nxs_anon_id=x');
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

// Mirrors FeatureFlagResolverService.evaluateSignedIn: a signed-in caller gets
// the id only when a live rule buckets by device, public flag or not.
describe('signed-in rollout id issuance', () => {
  it('sets no cookie while no rule buckets by device', async () => {
    addPublicPercentageFlag();
    const res = await getFlags(undefined, await loginAsUser());
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('issues a UUID for a device rule on a flag that is not public', async () => {
    addPercentageFlag(
      { public: false },
      { type: 'percentage', percent: 100, bucketBy: 'device' }
    );
    const res = await getFlags(undefined, await loginAsUser());
    expect(res.headers.get('set-cookie') ?? '').toMatch(UUID_COOKIE);
    const body = (await res.json()) as { flags: Record<string, boolean> };
    expect(body.flags['public-rollout']).toBe(true);
  });

  it('buckets a device rule by the cookie the guest already held', async () => {
    const user = [...getState().users.values()].find(
      (u) => u.email === 'user@example.com'
    );
    // Pick a cookie on the other side of the split from the user id, so a
    // user-keyed bucket would give the opposite result.
    const userIsIn = percentageBucket(user?.id ?? '', 'public-rollout') < 50;
    let anonId = '';
    for (let i = 0; anonId === ''; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      if (percentageBucket(id, 'public-rollout') < 50 !== userIsIn) anonId = id;
    }
    addPercentageFlag(
      { public: true },
      { type: 'percentage', percent: 50, bucketBy: 'device' }
    );
    const guest = await getFlags(`nxs_anon_id=${anonId}`);
    const signedIn = await getFlags(
      `nxs_anon_id=${anonId}`,
      await loginAsUser()
    );
    const guestBody = (await guest.json()) as {
      flags: Record<string, boolean>;
    };
    const userBody = (await signedIn.json()) as {
      flags: Record<string, boolean>;
    };
    expect(guestBody.flags['public-rollout']).toBe(!userIsIn);
    expect(userBody.flags['public-rollout']).toBe(!userIsIn);
    expect(signedIn.headers.get('set-cookie')).toBeNull();
  });
});
