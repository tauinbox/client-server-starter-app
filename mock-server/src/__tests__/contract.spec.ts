import type { Server } from 'http';
import {
  type LoadedRoute,
  loadRouteContracts
} from '@app/shared/utils/route-contracts';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';

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

test.each<LoadedRoute>(loadRouteContracts())(
  '$method $path → $expectedStatus',
  async ({ method, path, expectedStatus }) => {
    const response = await fetch(`${baseUrl}${path}`, { method });

    expect(response.status).toBe(expectedStatus);
  }
);
