import { INestApplication, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { DATA_REGIONS, REGIONS } from '@app/shared/constants';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
import { isolatedConfig } from '../src/common/testing/isolated-config';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { RegionService } from '../src/modules/core/region/region.service';
import { withPrivateThrottlerStorage } from './private-throttler';

const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const SPA_ORIGIN = 'https://app.example.com';
const OWN_HOST_REGION = DATA_REGIONS.find(
  (region) => REGIONS[region].apiSubdomain !== null
);
const LOGIN = '/api/v1/auth/login';
// No account has this email, so a request that passes the guard gets the
// refusal of the handler and not the refusal of the guard.
const CREDENTIALS = {
  email: 'origin-guard-nobody@example.com',
  password: 'Sunrise-Kettle-19'
};

runWithInfra('Origin guard of a pool with an API host of its own (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
        .overrideProvider(RegionService)
        .useValue(
          new RegionService(
            isolatedConfig({
              DATA_REGION: OWN_HOST_REGION,
              CLIENT_URL: `${SPA_ORIGIN}/`
            })
          )
        )
    ).compile();

    const expressApp = moduleRef.createNestApplication<NestExpressApplication>(
      HTTP_BODY_APP_OPTIONS
    );

    applyBodyParsers(expressApp);
    app = expressApp;
    app.useGlobalPipes(new ApiValidationPipe());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  it('has a region whose API is on a host of its own', () => {
    expect(OWN_HOST_REGION).toBeDefined();
  });

  it.each(['https://other.app.example.com', 'null'])(
    'refuses a POST with the Origin %s before the handler runs',
    async (origin) => {
      const res = await request(http())
        .post(LOGIN)
        .set('Origin', origin)
        .send(CREDENTIALS);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ message: 'Origin not allowed' });
    }
  );

  it('passes a POST from the SPA origin to the handler', async () => {
    const res = await request(http())
      .post(LOGIN)
      .set('Origin', SPA_ORIGIN)
      .send(CREDENTIALS);

    expect(res.status).toBe(401);
  });

  it('passes a POST with no Origin and no cookie, as a provider webhook sends it', async () => {
    const res = await request(http()).post(LOGIN).send(CREDENTIALS);

    expect(res.status).toBe(401);
  });

  // Firefox before 70 and Edge before 79 sent no Origin on a POST.
  it('refuses a POST with a cookie and no Origin before the handler runs', async () => {
    const res = await request(http())
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', 'refresh_token=any');

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ message: 'Origin not allowed' });
  });

  it('passes a GET with another Origin', async () => {
    const res = await request(http())
      .get('/api/v1/config/region')
      .set('Origin', 'https://other.app.example.com');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ region: OWN_HOST_REGION });
  });
});
