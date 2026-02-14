import { test as base, expect } from '@playwright/test';
import { createApp } from '../../../mock-server/src/app';
import { resetState } from '../../../mock-server/src/state';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

export type MockServerApi = {
  url: string;
  reset(): void;
  getState(): Promise<{
    users: unknown[];
    oauthAccounts: Record<string, unknown[]>;
    refreshTokens: number;
  }>;
  seedUsers(
    users: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      password: string;
      isActive: boolean;
      isAdmin: boolean;
      createdAt: string;
      updatedAt: string;
    }[]
  ): Promise<void>;
  seedOAuthAccounts(
    userId: string,
    accounts: {
      provider: string;
      providerId: string;
      createdAt: string;
    }[]
  ): Promise<void>;
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
