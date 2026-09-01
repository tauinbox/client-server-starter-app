import type { INestApplication } from '@nestjs/common';
import { Logger, VersioningType } from '@nestjs/common';
import type { Server } from 'http';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as passport from 'passport';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { Strategy as OAuth2Strategy } from 'passport-oauth2';
import { OAuthController } from './oauth.controller';
import { OAuthService } from '../services/oauth.service';
import { OAuthAccountService } from '../services/oauth-account.service';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { CLIENT_URL } from '../providers/client-url.provider';
import { CookieStateStore } from '../utils/cookie-state-store';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import { TOKEN_PURPOSE } from '@app/shared/constants';

const CLIENT = 'http://localhost:4200';
const REAUTH_TOKEN = 'reauth-token-for-user-a';
const OWNER_ID = 'user-a';
const SIGNED_PROOF = 'signed-reauth-proof';
const PROVIDER_ID = 'google-id-of-the-signer';

/**
 * Answers the token exchange, so the real passport-oauth2 pipeline can complete
 * a round trip without a provider.
 */
function startProviderStub(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'at', token_type: 'Bearer' }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function stateFromRedirect(location: string): string {
  return new URL(location).searchParams.get('state')!;
}

/**
 * A browser replays every cookie it holds across the whole flow, and the
 * binding this file covers is written on one request and read on another.
 */
class CookieJar {
  private readonly entries = new Map<string, string>();

  set(name: string, value: string): void {
    this.entries.set(name, value);
  }

  get(name: string): string | undefined {
    return this.entries.get(name);
  }

  absorb(setCookie: string | string[]): void {
    const raws = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const raw of raws) {
      const [name, ...rest] = raw.split(';')[0].split('=');
      const value = rest.join('=');
      if (value === '') {
        this.entries.delete(name);
      } else {
        this.entries.set(name, value);
      }
    }
  }

  header(): string[] {
    return [...this.entries].map(([name, value]) => `${name}=${value}`);
  }
}

describe('OAuth step-up re-authentication (real Passport pipeline)', () => {
  let app: INestApplication;
  let server: Server;
  let providerStub: Server;
  let assertReauthenticated: jest.Mock;
  let loginWithOAuth: jest.Mock;
  let linkOAuthToUser: jest.Mock;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const stub = await startProviderStub();
    providerStub = stub.server;

    passport.use(
      'google',
      new OAuth2Strategy(
        {
          authorizationURL: `${stub.url}/authorize`,
          tokenURL: `${stub.url}/token`,
          clientID: 'client-id',
          clientSecret: 'client-secret',
          callbackURL: '/api/v1/auth/oauth/google/callback',
          state: true,
          store: new CookieStateStore(OAuthProvider.GOOGLE, false)
        },
        (
          _accessToken: string,
          _refreshToken: string,
          _profile: unknown,
          done: (err: unknown, user?: unknown) => void
        ) => {
          done(null, {
            provider: OAuthProvider.GOOGLE,
            providerId: PROVIDER_ID,
            email: 'signer@example.com',
            firstName: 'Signer',
            lastName: 'Person',
            emailVerified: true
          });
        }
      )
    );

    assertReauthenticated = jest.fn().mockResolvedValue(undefined);
    linkOAuthToUser = jest.fn().mockResolvedValue(undefined);
    loginWithOAuth = jest.fn().mockResolvedValue({
      tokens: { accessToken: 'a', refreshToken: 'r' },
      user: { id: 'signer', email: 'signer@example.com' }
    });

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [OAuthController],
      providers: [
        {
          provide: OAuthService,
          useValue: { assertReauthenticated, linkOAuthToUser, loginWithOAuth }
        },
        {
          provide: OAuthAccountService,
          useValue: { findByUserId: jest.fn(), unlinkProvider: jest.fn() }
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: MailService,
          useValue: { sendOAuthUnlinkedNotification: jest.fn() }
        },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'test') } },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(() => SIGNED_PROOF),
            verify: jest.fn((token: string) => {
              if (token !== REAUTH_TOKEN) {
                throw new Error('invalid token');
              }
              return {
                sub: OWNER_ID,
                purpose: TOKEN_PURPOSE.OAUTH_REAUTH,
                iat: Math.floor(Date.now() / 1000)
              };
            })
          }
        },
        { provide: CLIENT_URL, useValue: CLIENT }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    passport.unuse('google');
    await app.close();
    await new Promise<void>((resolve) => providerStub.close(() => resolve()));
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    assertReauthenticated.mockClear().mockResolvedValue(undefined);
    loginWithOAuth.mockClear();
    linkOAuthToUser.mockClear();
  });

  async function authorize(jar: CookieJar): Promise<string> {
    const response = await request(server)
      .get('/api/v1/auth/oauth/google')
      .set('Cookie', jar.header());

    expect(response.status).toBe(302);
    jar.absorb(response.headers['set-cookie'] ?? []);

    return stateFromRedirect(response.headers['location']);
  }

  async function callback(jar: CookieJar, state: string): Promise<string> {
    const response = await request(server)
      .get(`/api/v1/auth/oauth/google/callback?code=abc&state=${state}`)
      .set('Cookie', jar.header());

    expect(response.status).toBe(302);
    jar.absorb(response.headers['set-cookie'] ?? []);

    return response.headers['location'];
  }

  it('reaches the re-auth branch on a real round trip and mints a proof', async () => {
    const jar = new CookieJar();
    jar.set('oauth_reauth', REAUTH_TOKEN);

    const state = await authorize(jar);

    expect(await callback(jar, state)).toBe(`${CLIENT}/profile?reauth=ok`);
    expect(assertReauthenticated).toHaveBeenCalledWith(
      OWNER_ID,
      OAuthProvider.GOOGLE,
      PROVIDER_ID,
      expect.any(Number)
    );
    expect(jar.get('reauth_proof')).toBe(SIGNED_PROOF);
    expect(jar.get('oauth_reauth')).toBeUndefined();
    expect(loginWithOAuth).not.toHaveBeenCalled();
  });

  it('mints nothing when a second flow presents its own state', async () => {
    const jar = new CookieJar();
    jar.set('oauth_reauth', REAUTH_TOKEN);

    const abandonedState = await authorize(jar);
    const strangerState = await authorize(jar);

    expect(strangerState).not.toBe(abandonedState);

    const target = await callback(jar, strangerState);

    expect(assertReauthenticated).not.toHaveBeenCalled();
    expect(jar.get('reauth_proof')).toBeUndefined();
    expect(loginWithOAuth).toHaveBeenCalled();
    expect(target).toBe(`${CLIENT}/oauth/callback`);
  });

  it('mints nothing when the provider identity belongs to another account', async () => {
    assertReauthenticated.mockRejectedValue(new Error('not this account'));

    const jar = new CookieJar();
    jar.set('oauth_reauth', REAUTH_TOKEN);

    const state = await authorize(jar);

    expect(await callback(jar, state)).toBe(
      `${CLIENT}/profile?oauth_error=reauth_failed`
    );
    expect(jar.get('reauth_proof')).toBeUndefined();
  });

  it('takes the re-auth branch ahead of a link intent left by an earlier flow', async () => {
    const jar = new CookieJar();
    jar.set('oauth_link', 'some-link-token');
    jar.set('oauth_reauth', REAUTH_TOKEN);

    const state = await authorize(jar);

    expect(await callback(jar, state)).toBe(`${CLIENT}/profile?reauth=ok`);
    expect(linkOAuthToUser).not.toHaveBeenCalled();
  });
});
