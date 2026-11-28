import type { Server } from 'http';
import type { Page } from '@playwright/test';
import type { MockUser } from './mock-data';
import { DATA_REGIONS, REGIONS, type DataRegion } from '@app/shared/constants';
import { createApp } from '../../../mock-server/src/app';
import {
  createMockInstance,
  type MockInstance
} from '../../../mock-server/src/instance';
import { resetState } from '../../../mock-server/src/state';
import {
  listenOnUnblockedPort,
  portOf
} from '../../../mock-server/src/utils/listen';
import { expect, test as base } from './base.fixture';
import { trackRoutedRequest } from './pending-requests';

/**
 * The host of the SPA in a test of many regions. Chromium resolves each
 * `*.localhost` name to the loopback, and the API host of a region
 * (`<apiSubdomain>.nexus.localhost`) is then in the same site as the SPA, as
 * `ru-api.<domain>` is in production. Under `localhost` itself it is not:
 * `localhost` and `ru-api.localhost` are two sites, and the browser drops a
 * `SameSite=strict` cookie between them.
 */
export const SPA_HOST = 'nexus.localhost';

/** The origin of the SPA on `SPA_HOST`, with the port of `baseURL`. */
function spaOrigin(baseURL: string | undefined): string {
  const url = new URL(baseURL ?? 'http://localhost');

  url.hostname = SPA_HOST;

  return url.origin;
}

type RegionServer = {
  region: DataRegion;
  subdomain: string;
  instance: MockInstance;
  server: Server;
};

/** The mock instance of a region whose API is not on the origin of the SPA. */
export type RegionMock = {
  region: DataRegion;
  instance: MockInstance;
  /** The direct URL of the instance, for the `__control` routes. */
  url: string;
  /** The origin of the API of the region, as the client of the test calls it. */
  apiOrigin: string;
};

type WorkerFixtures = {
  _regionServers: RegionServer[];
};

type TestFixtures = {
  regions: RegionMock[];
};

/**
 * One mock instance for each region with an `apiSubdomain`, beside the home
 * instance of `base.fixture`. A host resolver rule of the browser sends the
 * API host of each region to its instance, so a call keeps its URL: the
 * browser keys its cookies on the real host, sends the real `Origin` and runs
 * CORS. A `page.route` rewrite of the URL would key the cookies on the
 * rewritten host and mix the cookies of two regions.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  _regionServers: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, { project }) => {
      const servers: RegionServer[] = [];
      // The CORS answer and the Origin guard of a region host accept only
      // the SPA, as the pool of the region with its CLIENT_URL.
      const clientUrl = spaOrigin(project.use.baseURL);

      for (const region of DATA_REGIONS) {
        const { apiSubdomain } = REGIONS[region];

        if (apiSubdomain === null) continue;

        const instance = createMockInstance(region);

        servers.push({
          region,
          subdomain: apiSubdomain,
          instance,
          server: await listenOnUnblockedPort(
            createApp({ instance, clientUrl })
          )
        });
      }

      await use(servers);

      for (const { server } of servers) server.close();
    },
    { scope: 'worker' }
  ],

  launchOptions: [
    async ({ launchOptions, _regionServers }, use) => {
      const rules = _regionServers
        .map(
          ({ subdomain, server }) =>
            `MAP ${subdomain}.${SPA_HOST} 127.0.0.1:${portOf(server)}`
        )
        .join(', ');

      await use({
        ...launchOptions,
        args: [...(launchOptions.args ?? []), `--host-resolver-rules=${rules}`]
      });
    },
    { scope: 'worker' }
  ],

  baseURL: async ({ baseURL }, use) => {
    await use(spaOrigin(baseURL));
  },

  // After `_mockServer`: a route registered later is matched first, so these
  // routes take the region hosts out of the rewrite to the home instance.
  regions: async ({ _mockServer, page, baseURL, _regionServers }, use) => {
    void _mockServer;
    const spa = new URL(baseURL ?? '');
    const mocks: RegionMock[] = [];

    for (const { region, subdomain, instance, server } of _regionServers) {
      resetState(instance);
      const apiOrigin = `${spa.protocol}//${subdomain}.${spa.host}`;
      const isRegionApi = (url: URL) =>
        url.origin === apiOrigin && url.pathname.startsWith('/api/');

      await page.route(isRegionApi, (route) => {
        trackRoutedRequest(page, route.request());

        return route.continue();
      });
      // As the stub of the home stream, with the CORS answer of a
      // cross-origin stream.
      await page.route(
        (url) =>
          isRegionApi(url) && url.pathname.endsWith('/notifications/stream'),
        (route) =>
          route.fulfill({
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Access-Control-Allow-Origin': spa.origin,
              'Access-Control-Allow-Credentials': 'true'
            },
            body: ''
          })
      );
      mocks.push({
        region,
        instance,
        url: `http://localhost:${portOf(server)}`,
        apiOrigin
      });
    }

    await use(mocks);
  }
});

/**
 * Creates a resident of the region in its instance and signs in on the API
 * host of the region from the SPA origin, so the browser keeps the host-only
 * refresh cookie of that host, as after a sign-in in the app. Answers the
 * user and the signed-in user of the answer.
 */
export async function signInOnRegionHost(
  page: Page,
  { region, url, apiOrigin }: RegionMock
): Promise<{ user: Partial<MockUser>; signedIn: unknown }> {
  const [residenceCountry] = REGIONS[region].countries;
  // The control route stores a field that a test leaves out as null.
  const user = {
    id: `region-${region}`,
    email: `resident-${region}@example.com`,
    name: 'Regional Resident',
    password: 'Password1',
    isActive: true,
    roles: ['user'],
    isEmailVerified: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    locale: 'en',
    residenceCountry,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z'
  } satisfies Partial<MockUser>;

  await fetch(`${url}/__control/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([user])
  });

  await page.goto('/assets/i18n/en.json');
  const signedIn = await page.evaluate(
    async ({ origin, email, password }) => {
      const response = await fetch(`${origin}/api/v1/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      return ((await response.json()) as { user: unknown }).user;
    },
    { origin: apiOrigin, email: user.email, password: user.password }
  );

  return { user, signedIn };
}

/**
 * Opens or closes the region in the registry of one instance. Each pool reads
 * the one registry through its settings replica, but each mock instance keeps
 * a store of its own: a test whose client reads the registry of a region host
 * opens the region there too.
 */
export async function setPublic(
  homeUrl: string,
  { region, isPublic }: { region: DataRegion; isPublic: boolean }
): Promise<void> {
  const login = await fetch(`${homeUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'Password1'
    })
  });
  const {
    tokens: { access_token: token }
  } = (await login.json()) as { tokens: { access_token: string } };
  const res = await fetch(`${homeUrl}/api/v1/admin/regions/${region}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ public: isPublic })
  });

  expect(res.status).toBe(200);
}

export { expect };
