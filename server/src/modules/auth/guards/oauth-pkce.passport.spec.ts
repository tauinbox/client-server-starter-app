import type { INestApplication } from '@nestjs/common';
import {
  Controller,
  Get,
  Logger,
  Req,
  UseFilters,
  UseGuards
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type { Server } from 'http';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import type { Request as ExpressRequest } from 'express';
import * as passport from 'passport';
import { ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { Strategy as OAuth2Strategy } from 'passport-oauth2';
import { createOAuthProviderGuard } from './oauth-provider.guard';
import { OAuthAuthenticationExceptionFilter } from '../filters/oauth-authentication-exception.filter';
import { CLIENT_URL } from '../providers/client-url.provider';
import { CookieStateStore } from '../utils/cookie-state-store';
import { OAuthProvider } from '../enums/oauth-provider.enum';

const CLIENT = 'http://localhost:4200';
const STRATEGY = 'pkce-test';

/**
 * A provider that enforces PKCE (RFC 7636 4.6): it remembers the challenge of
 * each code it issues, and it refuses a token exchange whose verifier does not
 * hash to that challenge, or that has no verifier for a code with a challenge.
 */
function startProvider(): Promise<{ server: Server; url: string }> {
  const challenges = new Map<string, string | null>();

  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://provider');

      if (url.pathname === '/authorize') {
        const code = randomBytes(8).toString('hex');
        challenges.set(code, url.searchParams.get('code_challenge'));
        const back = new URL(url.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', code);
        back.searchParams.set('state', url.searchParams.get('state')!);
        res.writeHead(302, { Location: back.toString() });
        res.end();
        return;
      }

      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        const challenge = challenges.get(form.get('code')!);
        const verifier = form.get('code_verifier');
        const accepted =
          challenge === null
            ? verifier === null
            : verifier !== null &&
              createHash('sha256').update(verifier).digest('base64url') ===
                challenge;

        res.writeHead(accepted ? 200 : 400, {
          'Content-Type': 'application/json'
        });
        res.end(
          JSON.stringify(
            accepted
              ? { access_token: 'at', token_type: 'Bearer' }
              : { error: 'invalid_grant' }
          )
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

const PkceGuard = createOAuthProviderGuard(STRATEGY, 'Test');

@Controller('oauth')
@UseFilters(OAuthAuthenticationExceptionFilter)
class PkceOAuthController {
  @Get('start')
  @UseGuards(PkceGuard)
  start(): void {}

  @Get('callback')
  @UseGuards(PkceGuard)
  callback(@Req() req: ExpressRequest): unknown {
    return req.user;
  }
}

/** One browser: it replays the cookies it was given on each request. */
class Browser {
  private readonly cookies = new Map<string, string>();

  absorb(setCookie: string | string[] | undefined): void {
    const raws = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
    for (const raw of raws.filter(Boolean)) {
      const [name, ...rest] = raw.split(';')[0].split('=');
      this.cookies.set(name, rest.join('='));
    }
  }

  header(): string[] {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`);
  }
}

describe('OAuth PKCE (real passport-oauth2 against an enforcing provider)', () => {
  let app: INestApplication;
  let server: Server;
  let provider: { server: Server; url: string };

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    provider = await startProvider();

    passport.use(
      STRATEGY,
      new OAuth2Strategy(
        {
          authorizationURL: `${provider.url}/authorize`,
          tokenURL: `${provider.url}/token`,
          clientID: 'client-id',
          clientSecret: 'client-secret',
          callbackURL: '/oauth/callback',
          state: true,
          pkce: true,
          store: new CookieStateStore(OAuthProvider.GOOGLE, true)
        },
        (
          _accessToken: string,
          _refreshToken: string,
          _profile: unknown,
          done: (err: unknown, user?: unknown) => void
        ) => done(null, { signedIn: true })
      )
    );

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [PkceOAuthController],
      providers: [
        OAuthAuthenticationExceptionFilter,
        { provide: CLIENT_URL, useValue: CLIENT },
        { provide: ConfigService, useValue: { get: () => 'production' } }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    passport.unuse(STRATEGY);
    await app.close();
    await new Promise<void>((resolve) =>
      provider.server.close(() => resolve())
    );
    jest.restoreAllMocks();
  });

  /** Starts a flow and returns the code and state the provider sends back. */
  async function authorize(
    browser: Browser
  ): Promise<{ code: string; state: string }> {
    const start = await request(server)
      .get('/oauth/start')
      .set('Cookie', browser.header());
    expect(start.status).toBe(302);
    browser.absorb(start.headers['set-cookie']);

    const consent = new URL(start.headers['location']);
    const granted = await request(provider.url).get(
      consent.pathname + consent.search
    );
    const back = new URL(granted.headers['location']);

    return {
      code: back.searchParams.get('code')!,
      state: back.searchParams.get('state')!
    };
  }

  function callback(browser: Browser, code: string, state: string) {
    return request(server)
      .get(`/oauth/callback?code=${code}&state=${state}`)
      .set('Cookie', browser.header());
  }

  it('completes a flow with the verifier of its own challenge', async () => {
    const browser = new Browser();
    const { code, state } = await authorize(browser);

    const response = await callback(browser, code, state);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ signedIn: true });
  });

  it('refuses a code injected into another flow of another browser', async () => {
    const victim = new Browser();
    const attacker = new Browser();
    const stolen = await authorize(victim);
    const own = await authorize(attacker);

    // The state check passes: the attacker presents a state from their own
    // flow. Only the verifier ties the code to the flow that requested it.
    const response = await callback(attacker, stolen.code, own.state);

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe(
      `${CLIENT}/login?oauth_error=auth_failed`
    );
  });
});
