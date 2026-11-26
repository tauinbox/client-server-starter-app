import type { Server } from 'http';
import {
  DATA_REGIONS,
  HOME_DATA_REGION,
  type DataRegion
} from '@app/shared/constants';
import { createApp } from '../app';
import { createMockInstance, runInInstance } from '../instance';
import { countSseConnections } from '../sse-hub';
import { findUserByEmail, getState } from '../state';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';

const USER_EMAIL = 'user@example.com';
const SEED_PASSWORD = 'Password1';
const [otherRegion] = DATA_REGIONS.filter((r) => r !== HOME_DATA_REGION);

type Running = {
  instance: ReturnType<typeof createMockInstance>;
  server: Server;
  baseUrl: string;
};

async function start(region: DataRegion): Promise<Running> {
  const instance = createMockInstance(region);
  const server = await listenOnUnblockedPort(createApp({ instance }));

  return { instance, server, baseUrl: baseUrlOf(server) };
}

async function signIn(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: USER_EMAIL, password: SEED_PASSWORD })
  });

  expect(res.status).toBe(200);
  const { tokens } = (await res.json()) as {
    tokens: { access_token: string };
  };

  return tokens.access_token;
}

function getProfile(baseUrl: string, token: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/profile`, {
    headers: { authorization: `Bearer ${token}` }
  });
}

let home: Running;
let other: Running;

beforeEach(async () => {
  home = await start(HOME_DATA_REGION);
  other = await start(otherRegion);
});

afterEach(async () => {
  await Promise.all(
    [home, other].map(
      ({ server }) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
});

describe('mock instances of two regions in one process', () => {
  it('reports the region of each instance', async () => {
    const regions = await Promise.all(
      [home, other].map(async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/api/v1/config/region`);
        const { region } = (await res.json()) as { region: string };

        return region;
      })
    );

    expect(regions).toEqual([HOME_DATA_REGION, otherRegion]);
  });

  it('keeps the writes of a request in the store of its instance', async () => {
    await signIn(other.baseUrl);

    const sessionsOf = ({ instance }: Running) =>
      runInInstance(instance, () => getState().refreshSessions.size);

    expect(sessionsOf(other)).toBe(1);
    expect(sessionsOf(home)).toBe(0);
  });

  it('refuses a token of another region, keyless as Passport', async () => {
    const token = await signIn(other.baseUrl);

    expect((await getProfile(other.baseUrl, token)).status).toBe(200);

    const res = await getProfile(home.baseUrl, token);

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body['message']).toBe('Unauthorized');
    expect(body).not.toHaveProperty('errorKey');
  });

  it('registers a stream only in the hub of its instance', async () => {
    const token = await signIn(other.baseUrl);
    const controller = new AbortController();
    const res = await fetch(`${other.baseUrl}/api/v1/notifications/stream`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal
    });

    expect(res.status).toBe(200);

    const userId = runInInstance(
      other.instance,
      () => findUserByEmail(USER_EMAIL)!.id
    );

    expect(
      runInInstance(other.instance, () => countSseConnections(userId))
    ).toBe(1);
    expect(
      runInInstance(home.instance, () => countSseConnections(userId))
    ).toBe(0);
    controller.abort();
  });
});
