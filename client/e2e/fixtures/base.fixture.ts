import { test as base, expect } from '@playwright/test';
import { createApp } from '../../../mock-server/src/app';
import { resetState } from '../../../mock-server/src/state';
import type { ControlApi } from '../../../mock-server/src/control.types';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// ControlApi is the single source of truth for all __control endpoints.
// TypeScript enforces that every ControlApi method is implemented in the
// api object below. When a new route is added to control.routes.ts, add it
// to ControlApi in mock-server/src/control.types.ts — TS will then error here
// until the fixture implements it.
export type MockServerApi = ControlApi & {
  url: string;
  reset(): void;
};

type WorkerFixtures = {
  _workerMockServer: { port: number; server: Server };
};

type TestFixtures = {
  _mockServer: MockServerApi;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  _workerMockServer: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const app = createApp();
      const server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, () => resolve(s));
      });
      const port = (server.address() as AddressInfo).port;
      console.log(`[Worker] Mock server started on port ${port}`);
      await use({ port, server });
      server.close();
    },
    { scope: 'worker' }
  ],

  _mockServer: async ({ _workerMockServer, page }, use) => {
    const { port } = _workerMockServer;
    const baseUrl = `http://localhost:${port}`;

    // Reset state before each test
    resetState();

    // Redirect all /api requests to worker's mock-server
    await page.route(/\/api\//, (route) => {
      const url = route
        .request()
        .url()
        .replace(/localhost:\d+/, `localhost:${port}`);
      return route.continue({ url });
    });

    const api: MockServerApi = {
      url: baseUrl,
      reset() {
        resetState();
      },
      async getState() {
        const res = await fetch(`${baseUrl}/__control/state`);
        return res.json();
      },
      async getTokens() {
        const res = await fetch(`${baseUrl}/__control/tokens`);
        return res.json();
      },
      async seedUsers(users) {
        await fetch(`${baseUrl}/__control/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(users)
        });
      },
      async seedOAuthAccounts(userId, accounts) {
        await fetch(`${baseUrl}/__control/oauth-accounts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, accounts })
        });
      },
      async seedRoles(roles) {
        await fetch(`${baseUrl}/__control/roles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(roles)
        });
      },
      async seedPermissions(permissions) {
        await fetch(`${baseUrl}/__control/permissions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(permissions)
        });
      },
      async seedRolePermissions(rolePermissions) {
        await fetch(`${baseUrl}/__control/role-permissions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rolePermissions)
        });
      }
    };

    await use(api);
  }
});

export { expect };

// Re-export jwt utils for session-restore tests that need them
export {
  base64url,
  createExpiredJwt,
  createMockJwt,
  createValidJwt
} from './jwt.utils';

// Re-export seed/mock data types and constants
export type { MockUser } from './mock-data';
export { defaultUser } from './mock-data';

// Re-export helpers
export {
  loginViaUi,
  expectAuthRedirect,
  expectForbiddenRedirect
} from './helpers';
