import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import type { RegionConfigResponse } from '@app/shared/types';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp();

  server = await listenOnUnblockedPort(app);
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetState();
});

function setPeers(peers: unknown): Promise<Response> {
  return fetch(`${baseUrl}/__control/region-peers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ peers })
  });
}

async function regionConfig(): Promise<RegionConfigResponse> {
  const res = await fetch(`${baseUrl}/api/v1/config/region`);

  expect(res.status).toBe(200);

  return (await res.json()) as RegionConfigResponse;
}

// Mirrors RegionService of the server: DATA_REGION and PEER_REGIONS.
describe('GET /api/v1/config/region', () => {
  it('answers the intl cell with no peers, as production', async () => {
    await expect(regionConfig()).resolves.toEqual({
      region: 'intl',
      peers: {},
      publicRegions: ['intl']
    });
  });

  it('answers the peers that a test sets, until the next reset', async () => {
    expect((await setPeers({ ru: 'https://ru.example.com' })).status).toBe(200);

    await expect(regionConfig()).resolves.toEqual({
      region: 'intl',
      peers: { ru: 'https://ru.example.com' },
      publicRegions: ['intl']
    });

    resetState();

    await expect(regionConfig()).resolves.toEqual({
      region: 'intl',
      peers: {},
      publicRegions: ['intl']
    });
  });

  // Mirrors RegionRegistryService of the server.
  it('lists a region that an administrator opens, until it is closed', async () => {
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'Password1'
      })
    });
    const {
      tokens: { access_token: token }
    } = (await login.json()) as { tokens: { access_token: string } };
    const setStatus = (isPublic: boolean) =>
      fetch(`${baseUrl}/api/v1/admin/regions/ru`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ public: isPublic })
      });

    expect((await setStatus(true)).status).toBe(200);
    expect((await regionConfig()).publicRegions).toEqual(['intl', 'ru']);

    expect((await setStatus(false)).status).toBe(200);
    expect((await regionConfig()).publicRegions).toEqual(['intl']);
  });

  // The boot check of the server refuses the same values.
  it.each([
    ['an unknown region', { eu: 'https://eu.example.com' }],
    ['the own region', { intl: 'https://app.example.com' }],
    ['a URL that is not https', { ru: 'http://ru.example.com' }],
    ['a value that is not a URL', { ru: 'ru.example.com' }],
    ['a value that is not a string', { ru: 1 }],
    ['an array', ['https://ru.example.com']]
  ])('refuses %s and keeps the peers', async (_case, peers) => {
    expect((await setPeers(peers)).status).toBe(400);

    await expect(regionConfig()).resolves.toEqual({
      region: 'intl',
      peers: {},
      publicRegions: ['intl']
    });
  });
});

describe('the residence refusal follows the peers', () => {
  async function registerRussianResident(): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'resident@example.com',
        password: 'Sunrise-Kettle-19',
        name: 'Region Probe',
        residenceCountry: 'RU'
      })
    });

    expect(res.status).toBe(409);

    return ((await res.json()) as { errorKey: string }).errorKey;
  }

  it('names a region that no cell serves while there is no peer', async () => {
    await expect(registerRussianResident()).resolves.toBe(
      ErrorKeys.AUTH.RESIDENCE_REGION_NOT_SERVED
    );
  });

  it('names another region once a peer serves it', async () => {
    await setPeers({ ru: 'https://ru.example.com' });

    await expect(registerRussianResident()).resolves.toBe(
      ErrorKeys.AUTH.RESIDENCE_OTHER_REGION
    );
  });
});
