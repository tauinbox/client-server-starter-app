import type { Server } from 'http';
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
import { test as base } from './base.fixture';
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
    async ({}, use) => {
      const servers: RegionServer[] = [];

      for (const region of DATA_REGIONS) {
        const { apiSubdomain } = REGIONS[region];

        if (apiSubdomain === null) continue;

        const instance = createMockInstance(region);

        servers.push({
          region,
          subdomain: apiSubdomain,
          instance,
          server: await listenOnUnblockedPort(createApp({ instance }))
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
    const url = new URL(baseURL ?? 'http://localhost');

    url.hostname = SPA_HOST;
    await use(url.origin);
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

export { expect } from './base.fixture';
