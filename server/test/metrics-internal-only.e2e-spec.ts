import { RequestMethod, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import { Server } from 'http';
import { CoreModule } from '../src/modules/core/core.module';
import { applyTrustProxy } from '../src/modules/core/trust-proxy.util';

// Bootstrap mirrors check-auth-coverage.e2e-spec.ts: DataSource.initialize is
// stubbed so the app boots without PostgreSQL. Trust proxy mirrors the
// docker-compose TRUSTED_PROXIES default so X-Forwarded-For simulates the
// client address a reverse proxy would report.
describe('Metrics endpoint — internal-network gating', () => {
  let app: NestExpressApplication;
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

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api', {
      exclude: [{ path: 'metrics', method: RequestMethod.GET }]
    });
    app.enableVersioning({ type: VersioningType.URI });
    applyTrustProxy(app, 'loopback,uniquelocal');
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  it('serves the scrape to an internal client', async () => {
    const res = await request(server).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.text).toContain('process_cpu_user_seconds_total');
  });

  it('rejects a public client with 403', async () => {
    const res = await request(server)
      .get('/metrics')
      .set('X-Forwarded-For', '203.0.113.10');

    expect(res.status).toBe(403);
  });

  it('ignores a spoofed internal X-Forwarded-For entry from a public client', async () => {
    const res = await request(server)
      .get('/metrics')
      .set('X-Forwarded-For', '10.0.0.1, 203.0.113.10');

    expect(res.status).toBe(403);
  });
});
