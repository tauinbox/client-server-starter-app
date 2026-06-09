import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as request from 'supertest';
import { Server } from 'http';
import { CoreModule } from '../src/modules/core/core.module';

interface RouteEntry {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'HEAD';
  path: string;
  expectedStatus: number;
}

const ROUTES_DIR = path.resolve(__dirname, '..', '..', 'contracts', 'routes');

// Flattens every per-feature file under contracts/routes/. New features add a
// JSON file there, no edit to this loader is required.
function loadManifestRoutes(): RouteEntry[] {
  return fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => {
      const { routes } = JSON.parse(
        fs.readFileSync(path.join(ROUTES_DIR, f), 'utf-8')
      ) as { routes: RouteEntry[] };
      return routes;
    });
}

// Iterates over contracts/routes.json — for every route declared as
// expectedStatus=401 (i.e. requires authentication), confirms the running
// server actually returns 401 when the request omits a bearer token. This
// catches regressions where a future endpoint is added without @Public()
// and without @Authorize() — silently exposing it.
//
// Bootstrap mirrors bootstrap.e2e-spec.ts: DataSource.initialize is stubbed
// so the app boots without a live PostgreSQL instance. Routes that would
// touch the DB after passing the JwtAuthGuard are not exercised here, since
// every route under test returns 401 from the global guard before reaching
// service code.
describe('Auth coverage — every protected route rejects unauthenticated access', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    jest.spyOn(DataSource.prototype, 'initialize').mockImplementation(function (
      this: DataSource
    ) {
      return Promise.resolve(this);
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      })
    );
    app.setGlobalPrefix('api', {
      exclude: [{ path: 'metrics', method: RequestMethod.GET }]
    });
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  const protectedRoutes = loadManifestRoutes().filter(
    (r) => r.expectedStatus === 401
  );

  it('routes.json declares at least one protected route', () => {
    expect(protectedRoutes.length).toBeGreaterThan(10);
  });

  test.each(protectedRoutes.map((r) => [`${r.method} ${r.path}`, r]))(
    '%s returns 401 without token',
    async (_label, route) => {
      const method = route.method.toLowerCase() as
        | 'get'
        | 'post'
        | 'patch'
        | 'put'
        | 'delete';
      const res = await request(server)[method](route.path);
      expect(res.status).toBe(401);
    }
  );
});
