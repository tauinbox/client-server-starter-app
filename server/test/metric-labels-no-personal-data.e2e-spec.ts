import {
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  RequestMethod,
  VersioningType
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { Server } from 'http';
import { register } from 'prom-client';
import { CoreModule } from '../src/modules/core/core.module';
import { Public } from '../src/modules/auth/decorators/public.decorator';

const EMAIL = 'someone@example.com';
const IP = '203.0.113.7';

@Controller({ path: 'metric-label-probe', version: '1' })
class MetricLabelProbeController {
  @Public()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): { id: string } {
    return { id };
  }

  @Public()
  @Get('by-name/:name')
  findByName(@Param('name') name: string): { name: string } {
    return { name };
  }
}

@Module({ controllers: [MetricLabelProbeController] })
class MetricLabelProbeModule {}

// A label name made of one of these words holds a person or a device.
const PERSONAL_LABEL_WORDS = new Set([
  'user',
  'uid',
  'id',
  'email',
  'ip',
  'addr',
  'address',
  'session',
  'customer',
  'account',
  'phone',
  'login'
]);

const EMAIL_PATTERN = /[^\s"@]+@[^\s"@]+\.[a-z]{2,}/i;
const IPV4_PATTERN = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function labelWords(labelName: string): string[] {
  return labelName
    .replaceAll(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split('_');
}

function labelValues(scrape: string): string[] {
  return [...scrape.matchAll(/\w+="((?:[^"\\]|\\.)*)"/g)].map(
    ([, value]) => value
  );
}

describe('Metric labels hold no user id, email or IP address', () => {
  let app: NestExpressApplication;
  let server: Server;

  beforeAll(async () => {
    jest.spyOn(DataSource.prototype, 'initialize').mockImplementation(function (
      this: DataSource
    ) {
      return Promise.resolve(this);
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot(), MetricLabelProbeModule]
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api', {
      exclude: [{ path: 'metrics', method: RequestMethod.GET }]
    });
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  it('declares no label whose name is a personal identifier', () => {
    const offending = register
      .getMetricsAsArray()
      .flatMap((metric) =>
        'labelNames' in metric && Array.isArray(metric.labelNames)
          ? metric.labelNames.map((label) => `${metric.name}{${label}}`)
          : []
      )
      .filter((entry) =>
        labelWords(entry.slice(entry.indexOf('{') + 1, -1)).some((word) =>
          PERSONAL_LABEL_WORDS.has(word)
        )
      );

    expect(offending).toEqual([]);
  });

  it('labels a request by its route template, not by the values in its path', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';

    await request(server).get(`/api/v1/metric-label-probe/${uuid}`).expect(200);
    await request(server)
      .get(`/api/v1/metric-label-probe/${EMAIL}`)
      .expect(400);
    await request(server).get(`/api/v1/metric-label-probe/${IP}`).expect(400);
    await request(server)
      .get(`/api/v1/metric-label-probe/by-name/${EMAIL}`)
      .expect(200);

    const { text } = await request(server).get('/metrics').expect(200);
    const values = labelValues(text);

    expect(
      values.filter(
        (value) =>
          EMAIL_PATTERN.test(value) ||
          IPV4_PATTERN.test(value) ||
          UUID_PATTERN.test(value)
      )
    ).toEqual([]);
    expect(values).toContain('/api/v1/metric-label-probe/:id');
    expect(values).toContain('/api/v1/metric-label-probe/by-name/:name');
  });
});
