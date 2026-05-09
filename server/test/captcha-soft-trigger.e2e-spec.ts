import {
  Body,
  Controller,
  INestApplication,
  Module,
  Post,
  UseGuards
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule, Throttle } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { CaptchaService } from '../src/modules/auth/captcha/captcha.service';
import { CaptchaRequiredGuard } from '../src/modules/auth/captcha/captcha-required.guard';

@Controller('test')
class TestController {
  // Mirror the production /forgot-password rate-limit (limit=2). At limit=2,
  // the 1st attempt already drops X-RateLimit-Remaining to 1, which is the
  // soft-trigger threshold — captcha required from the very first attempt.
  @Throttle({ default: { ttl: 300_000, limit: 2 } })
  @UseGuards(CaptchaRequiredGuard)
  @Post('soft-trigger')
  handler(@Body() _body: unknown): { ok: true } {
    return { ok: true };
  }

  // No throttle decorator on this route — uses the global default with limit
  // 1000 (set below). Validates the "remaining > threshold ⇒ no captcha" path.
  @UseGuards(CaptchaRequiredGuard)
  @Post('no-trigger')
  handlerNoTrigger(@Body() _body: unknown): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ ignoreEnvFile: true }),
    // Global default with high limit so /no-trigger never approaches the
    // threshold; route-level @Throttle overrides for /soft-trigger.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }])
  ],
  controllers: [TestController],
  providers: [
    CaptchaService,
    CaptchaRequiredGuard,
    { provide: APP_GUARD, useClass: ThrottlerGuard }
  ]
})
class CaptchaTestModule {}

describe('CAPTCHA soft-trigger (e2e)', () => {
  let app: INestApplication;
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(async () => {
    process.env['TURNSTILE_SITE_KEY'] = 'test-site-key';
    process.env['TURNSTILE_SECRET_KEY'] = 'test-secret-key';

    const moduleRef = await Test.createTestingModule({
      imports: [CaptchaTestModule]
    }).compile();

    app = moduleRef.createNestApplication();
    // Enable trust-proxy so X-Forwarded-For is honoured — lets each test use
    // a unique IP and avoid sharing the throttler counter.
    const httpInstance = app.getHttpAdapter().getInstance() as {
      set: (key: string, value: unknown) => void;
    };
    httpInstance.set('trust proxy', true);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    process.env = ORIGINAL_ENV;
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  beforeEach(() => {
    // Each test starts with a fresh CaptchaService spy and runs against the
    // same throttler storage; tests use unique X-Forwarded-For IPs to avoid
    // counter contamination.
    const svc = app.get(CaptchaService);
    jest.spyOn(svc, 'verify').mockReset();
  });

  it('rejects the first throttle-limit=2 attempt without a captcha token', async () => {
    const verifySpy = jest.spyOn(app.get(CaptchaService), 'verify');

    const res = await request(http())
      .post('/test/soft-trigger')
      .set('X-Forwarded-For', '10.0.0.1')
      .send({ payload: 'x' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      errorKey: ErrorKeys.AUTH.CAPTCHA_REQUIRED
    });
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('rejects with CAPTCHA_INVALID when token verification fails', async () => {
    jest.spyOn(app.get(CaptchaService), 'verify').mockResolvedValueOnce(false);

    const res = await request(http())
      .post('/test/soft-trigger')
      .set('X-Forwarded-For', '10.0.0.2')
      .send({ captchaToken: 'bad' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      errorKey: ErrorKeys.AUTH.CAPTCHA_INVALID
    });
  });

  it('passes through with a valid captcha token', async () => {
    jest.spyOn(app.get(CaptchaService), 'verify').mockResolvedValueOnce(true);

    const res = await request(http())
      .post('/test/soft-trigger')
      .set('X-Forwarded-For', '10.0.0.3')
      .send({ captchaToken: 'good' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
  });

  it('does not require captcha when remaining is well above the threshold', async () => {
    const verifySpy = jest.spyOn(app.get(CaptchaService), 'verify');

    const res = await request(http())
      .post('/test/no-trigger')
      .set('X-Forwarded-For', '10.0.0.4')
      .send({ payload: 'x' });

    expect(res.status).toBe(201);
    expect(verifySpy).not.toHaveBeenCalled();
  });
});
