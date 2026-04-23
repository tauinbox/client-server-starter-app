import { Controller, Get, Module, Req } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import type { Server } from 'http';
import * as request from 'supertest';
import { applyTrustProxy } from '../src/modules/core/trust-proxy.util';

interface WhoAmIBody {
  ip: string | undefined;
  ips: string[];
}

@Controller('whoami')
class WhoAmIController {
  @Get()
  whoami(@Req() req: Request): WhoAmIBody {
    return { ip: req.ip, ips: req.ips };
  }
}

@Module({ controllers: [WhoAmIController] })
class TrustProxyTestModule {}

async function createApp(
  trustedProxies: string | undefined
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [TrustProxyTestModule]
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  applyTrustProxy(app, trustedProxies);
  await app.init();
  return app;
}

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

async function whoami(
  app: INestApplication,
  xForwardedFor: string
): Promise<{ status: number; body: WhoAmIBody }> {
  const res = await request(httpServer(app))
    .get('/whoami')
    .set('X-Forwarded-For', xForwardedFor);
  return { status: res.status, body: res.body as WhoAmIBody };
}

describe('trust proxy (e2e)', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('without TRUSTED_PROXIES — req.ip is the socket peer, X-Forwarded-For is ignored', async () => {
    app = await createApp(undefined);
    const res = await whoami(app, '1.2.3.4');

    expect(res.status).toBe(200);
    // supertest loops back on localhost — the peer is 127.0.0.1 / ::1, never
    // the spoofed X-Forwarded-For value.
    expect(res.body.ip).not.toBe('1.2.3.4');
    expect(res.body.ips).toEqual([]);
  });

  it('with TRUSTED_PROXIES=loopback — req.ip resolves to X-Forwarded-For', async () => {
    app = await createApp('loopback');
    const res = await whoami(app, '1.2.3.4');

    expect(res.status).toBe(200);
    expect(res.body.ip).toBe('1.2.3.4');
    expect(res.body.ips).toEqual(['1.2.3.4']);
  });

  it('peels the X-Forwarded-For chain back to the first untrusted hop', async () => {
    // Trust loopback + RFC1918 ranges. The rightmost hop 10.0.0.1 is trusted
    // (RFC1918), so Express walks past it and stops at 5.6.7.8, which is the
    // real client.
    app = await createApp('loopback,uniquelocal');
    const res = await whoami(app, '5.6.7.8, 10.0.0.1');

    expect(res.status).toBe(200);
    expect(res.body.ip).toBe('5.6.7.8');
  });

  it('stops at the first untrusted hop (does not trust arbitrary left-most IPs)', async () => {
    // Only loopback is trusted — the rightmost hop 10.0.0.1 is NOT trusted, so
    // Express stops there and does NOT expose the spoofable 5.6.7.8 value.
    app = await createApp('loopback');
    const res = await whoami(app, '5.6.7.8, 10.0.0.1');

    expect(res.status).toBe(200);
    expect(res.body.ip).toBe('10.0.0.1');
  });

  it('with TRUSTED_PROXIES=true — req.ip resolves to X-Forwarded-For (trust-everyone mode)', async () => {
    app = await createApp('true');
    const res = await whoami(app, '9.9.9.9');

    expect(res.status).toBe(200);
    expect(res.body.ip).toBe('9.9.9.9');
  });

  it('with TRUSTED_PROXIES=false — behaves like undefined (no trust)', async () => {
    app = await createApp('false');
    const res = await whoami(app, '1.2.3.4');

    expect(res.status).toBe(200);
    expect(res.body.ip).not.toBe('1.2.3.4');
  });

  it('with TRUSTED_PROXIES=10.0.0.0/8 (non-loopback CIDR) — localhost is NOT trusted, X-Forwarded-For ignored', async () => {
    app = await createApp('10.0.0.0/8');
    const res = await whoami(app, '1.2.3.4');

    expect(res.status).toBe(200);
    // Peer is loopback, which does not match 10.0.0.0/8 — header is dropped.
    expect(res.body.ip).not.toBe('1.2.3.4');
  });
});
