import type { Server } from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { createApp } from '../app';

type Route = {
  method: string;
  path: string;
  expectedStatus: number;
};

// Flattens every per-feature file under contracts/routes/. New features add a
// JSON file there, no edit to this loader is required.
const ROUTES_DIR = path.resolve(__dirname, '../../../contracts/routes');

function loadManifestRoutes(): Route[] {
  return fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => {
      const { routes } = JSON.parse(
        fs.readFileSync(path.join(ROUTES_DIR, f), 'utf-8')
      ) as { routes: Route[] };
      return routes;
    });
}

let server: Server;
let baseUrl: string;

beforeAll((done) => {
  const app = createApp();
  server = app.listen(0, () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://localhost:${port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

test.each<Route>(loadManifestRoutes())(
  '$method $path → $expectedStatus',
  async ({ method, path, expectedStatus }) => {
    const response = await fetch(`${baseUrl}${path}`, { method });
    expect(response.status).toBe(expectedStatus);
  }
);
