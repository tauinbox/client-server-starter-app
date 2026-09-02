import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Server } from 'http';
import { CoreModule } from '../src/modules/core/core.module';
import { withPrivateThrottlerStorage } from './private-throttler';

const MAILPIT_URL = process.env['MAILPIT_URL'] || 'http://localhost:8025';

// Boots the full application and exercises register → verification email →
// verify-email → login against a real Postgres and a Mailpit SMTP sink. Without
// SMTP_HOST the app posts nowhere, so the suite would wait out the delivery
// timeout instead of skipping.
const runWithInfra =
  process.env['DB_HOST'] && process.env['SMTP_HOST'] ? describe : describe.skip;

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

interface MailpitList {
  total: number;
  messages: MailpitMessage[];
}

async function clearMailpit(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}

/** Waits for one message to an address, optionally for one subject only. */
async function waitForEmailHtml(
  toAddress: string,
  subject?: string
): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const listRes = await fetch(`${MAILPIT_URL}/api/v1/messages`);
      if (listRes.ok) {
        const list = (await listRes.json()) as MailpitList;
        const hit = list.messages?.find(
          (m) =>
            m.To?.some((t) => t.Address === toAddress) &&
            (subject === undefined || m.Subject === subject)
        );
        if (hit) {
          const full = (await fetch(
            `${MAILPIT_URL}/api/v1/message/${hit.ID}`
          ).then((r) => r.json())) as { HTML: string };
          return full.HTML;
        }
      }
    } catch {
      // Mailpit may not accept connections on the first polls — retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `No email${subject ? ` "${subject}"` : ''} delivered to ${toAddress} within the timeout`
  );
}

runWithInfra('Email delivery (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    ).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      })
    );
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

  it('delivers a verification email whose token unblocks login', async () => {
    await clearMailpit();
    const email = `delivery-${Date.now()}@example.com`;
    const password = 'Sunrise-Kettle-19';

    await request(http())
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Del', lastName: 'Ivery' })
      .expect(201);

    // Login is blocked until the address is verified.
    await request(http())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(403);

    const html = await waitForEmailHtml(email);
    // Handlebars HTML-escapes `=` to `&#x3D;` inside the href (email clients
    // decode it on click); decode it before extracting the token.
    const decoded = html.replace(/&#x3d;/gi, '=').replace(/&#61;/g, '=');
    const match = decoded.match(/verify-email\?token=([A-Fa-f0-9]+)/);
    if (!match) {
      throw new Error('Verification email did not contain a token link');
    }

    await request(http())
      .post('/api/v1/auth/verify-email')
      .send({ token: match[1] })
      .expect(200);

    // Verified — login now succeeds and returns an access token.
    const login = await request(http())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const loginBody = login.body as {
      tokens?: { access_token?: string };
    };
    expect(loginBody.tokens?.access_token).toBeTruthy();
  }, 60000);

  // The notice is the only signal the owner of the account gets, so it is
  // proved against a real SMTP sink and not only against a mocked mailer.
  it('delivers a password-changed notice after a self-service change', async () => {
    await clearMailpit();
    const email = `pwd-notice-${Date.now()}@example.com`;
    const password = 'Sunrise-Kettle-19';

    await request(http())
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Del', lastName: 'Ivery' })
      .expect(201);

    const verificationHtml = await waitForEmailHtml(email);
    const decoded = verificationHtml
      .replace(/&#x3d;/gi, '=')
      .replace(/&#61;/g, '=');
    const match = decoded.match(/verify-email\?token=([A-Fa-f0-9]+)/);
    if (!match) {
      throw new Error('Verification email did not contain a token link');
    }

    await request(http())
      .post('/api/v1/auth/verify-email')
      .send({ token: match[1] })
      .expect(200);

    const login = await request(http())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const accessToken = (login.body as { tokens: { access_token: string } })
      .tokens.access_token;

    await request(http())
      .patch('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: 'Quartz-Meadow-77', currentPassword: password })
      .expect(200);

    const notice = await waitForEmailHtml(email, 'Your password was changed');
    expect(notice).toContain('profile page');
    expect(notice).toContain('UTC');
    // A notice must carry no action link at all.
    expect(notice).not.toContain('<a href');
  }, 60000);
});
