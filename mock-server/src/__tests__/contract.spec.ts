import type { Server } from 'http';
import { createApp } from '../app';
import routes from '../../../contracts/routes.json';

type Route = {
  method: string;
  path: string;
  expectedStatus: number;
};

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

test.each<Route>(routes.routes as Route[])(
  '$method $path → $expectedStatus',
  async ({ method, path, expectedStatus }) => {
    const response = await fetch(`${baseUrl}${path}`, { method });
    expect(response.status).toBe(expectedStatus);
  }
);
