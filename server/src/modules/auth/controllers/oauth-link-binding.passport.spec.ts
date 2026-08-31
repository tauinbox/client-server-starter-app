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
import { CLIENT_URL } from '../providers/client-url.provider';
import { CookieStateStore } from '../utils/cookie-state-store';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import { TOKEN_PURPOSE } from '@app/shared/constants';

const CLIENT = 'http://localhost:4200';
const LINK_TOKEN = 'link-token-for-user-a';
const OWNER_ID = 'user-a';

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

/** Reads the state that passport put on the provider redirect. */
function stateFromRedirect(location: string): string {
  return new URL(location).searchParams.get('state')!;
}

/**
 * A browser replays every cookie it holds across the whole flow, and the
 * binding this file covers is written on one request and read on another. A jar
 * is therefore the only shape that can express the scenario.
 */
class CookieJar {
  private readonly entries = new Map<string, string>();

  set(name: string, value: string): void {
    this.entries.set(name, value);
  }

  get(name: string): string | undefined {
    return this.entries.get(name);
  }

  /**
   * Supertest types `set-cookie` as a string, and Node gives an array. Both
   * shapes are normalized here, because a cast would only hide one of them.
   */
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

describe('OAuth link intent binding (real Passport pipeline)', () => {
  let app: INestApplication;
  let server: Server;
  let providerStub: Server;
  let linkOAuthToUser: jest.Mock;
  let loginWithOAuth: jest.Mock;

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
            providerId: 'google-id-of-the-signer',
            email: 'signer@example.com',
            firstName: 'Signer',
            lastName: 'Person',
            emailVerified: true
          });
        }
      )
    );

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
          useValue: { linkOAuthToUser, loginWithOAuth }
        },
        {
          provide: OAuthAccountService,
          useValue: { findByUserId: jest.fn(), unlinkProvider: jest.fn() }
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'test') } },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(() => 'signed'),
            verify: jest.fn((token: string) => {
              if (token !== LINK_TOKEN) {
                throw new Error('invalid token');
              }
              return {
                sub: OWNER_ID,
                purpose: TOKEN_PURPOSE.OAUTH_LINK,
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
    linkOAuthToUser.mockClear();
    loginWithOAuth.mockClear();
  });

  /** Starts an authorization request and returns the state it minted. */
  async function authorize(jar: CookieJar): Promise<string> {
    const response = await request(server)
      .get('/api/v1/auth/oauth/google')
      .set('Cookie', jar.header());

    expect(response.status).toBe(302);
    jar.absorb(response.headers['set-cookie'] ?? []);

    return stateFromRedirect(response.headers['location']);
  }

  /** Completes the provider round trip and returns the redirect target. */
  async function callback(jar: CookieJar, state: string): Promise<string> {
    const response = await request(server)
      .get(`/api/v1/auth/oauth/google/callback?code=abc&state=${state}`)
      .set('Cookie', jar.header());

    expect(response.status).toBe(302);
    jar.absorb(response.headers['set-cookie'] ?? []);

    return response.headers['location'];
  }

  it('reaches the link branch on a real round trip of the owning flow', async () => {
    const jar = new CookieJar();
    jar.set('oauth_link', LINK_TOKEN);

    const state = await authorize(jar);

    expect(await callback(jar, state)).toBe(
      `${CLIENT}/profile?oauth_linked=google`
    );
    expect(linkOAuthToUser).toHaveBeenCalledWith(
      OWNER_ID,
      OAuthProvider.GOOGLE,
      'google-id-of-the-signer',
      expect.any(Number),
      expect.anything()
    );
  });

  it('links nothing when a second flow presents its own state', async () => {
    const jar = new CookieJar();
    jar.set('oauth_link', LINK_TOKEN);

    // The owner starts a link and walks away without a sign-out.
    const abandonedState = await authorize(jar);
    // The next person signs in with their own account at the same browser.
    const strangerState = await authorize(jar);

    expect(strangerState).not.toBe(abandonedState);

    const target = await callback(jar, strangerState);

    expect(linkOAuthToUser).not.toHaveBeenCalled();
    expect(loginWithOAuth).toHaveBeenCalled();
    expect(target).toBe(`${CLIENT}/oauth/callback`);
  });

  it('writes no link cookie when the request carries none', async () => {
    const jar = new CookieJar();

    await authorize(jar);

    expect(jar.get('oauth_link')).toBeUndefined();
  });
});
