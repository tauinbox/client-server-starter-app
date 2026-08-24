import { Controller, Get, Query, UnauthorizedException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import type { Server } from 'http';
import {
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS
} from '@app/shared/constants';
import { LoginThrottlerGuard } from './login-throttler.guard';
import { buildThrottlerOptions } from './throttler-options';

@Controller('probe')
class ProbeController {
  // Mirrors the real login route: the same handler answers both outcomes, so
  // successes and failures share one throttler key.
  @Throttle({
    default: { ttl: 60000, limit: 1000 },
    'login-long-window': {
      ttl: LOCKOUT_DURATION_MS,
      limit: MAX_FAILED_ATTEMPTS - 1
    }
  })
  @Get('login')
  login(@Query('fail') fail?: string): { ok: boolean } {
    if (fail) {
      throw new UnauthorizedException();
    }
    return { ok: true };
  }
}

describe('LoginThrottlerGuard', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(buildThrottlerOptions(undefined))],
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: LoginThrottlerGuard }]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const login = async (fail: boolean): Promise<number> => {
    const res = await request(app.getHttpServer() as Server).get(
      fail ? '/probe/login?fail=1' : '/probe/login'
    );
    return res.status;
  };

  const repeat = async (times: number, fail: boolean): Promise<number[]> => {
    const statuses: number[] = [];
    for (let i = 0; i < times; i++) {
      statuses.push(await login(fail));
    }
    return statuses;
  };

  it('refunds successful logins, so they never spend the failed-attempt budget', async () => {
    await expect(repeat(MAX_FAILED_ATTEMPTS + 2, false)).resolves.toEqual([
      200, 200, 200, 200, 200, 200, 200
    ]);
  });

  it('counts failed logins and blocks the attempt that would trigger lockout', async () => {
    await expect(repeat(MAX_FAILED_ATTEMPTS, true)).resolves.toEqual([
      401, 401, 401, 401, 429
    ]);
  });

  it('leaves the failed-attempt budget intact after refunded successes', async () => {
    await repeat(MAX_FAILED_ATTEMPTS + 2, false);

    await expect(repeat(MAX_FAILED_ATTEMPTS, true)).resolves.toEqual([
      401, 401, 401, 401, 429
    ]);
  });
});
