import { randomUUID } from 'crypto';
import type { Server } from 'http';
import { ErrorKeys, TOKEN_PURPOSE } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, resetState } from '../state';

let server: Server;
let baseUrl: string;

const USER_EMAIL = 'user@example.com';
const SEED_PASSWORD = 'Password1';

beforeAll(async () => {
  resetState();
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetState();
});

type Session = { accessToken: string; refreshCookie: string };

async function signIn(): Promise<Session> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: USER_EMAIL, password: SEED_PASSWORD })
  });
  expect(res.status).toBe(200);
  const match = /refresh_token=([^;]+)/.exec(
    res.headers.get('set-cookie') ?? ''
  );
  const body = (await res.json()) as { tokens: { access_token: string } };
  return {
    accessToken: body.tokens.access_token,
    refreshCookie: `refresh_token=${match?.[1] ?? ''}`
  };
}

function encode(part: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(part)).toString('base64url');
}

function payloadOf(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf-8')
  ) as Record<string, unknown>;
}

/** The token of a live session, with some claims changed. */
function withClaims(token: string, claims: Record<string, unknown>): string {
  const [header, , signature] = token.split('.');
  return `${header}.${encode({ ...payloadOf(token), ...claims })}.${signature}`;
}

function getProfile(token: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/profile`, {
    headers: { authorization: `Bearer ${token}` }
  });
}

async function expectRefusal(
  res: Response,
  errorKey: string,
  message: string,
  challenge: string
): Promise<void> {
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({
    statusCode: 401,
    message,
    errorKey
  });
  expect(res.headers.get('www-authenticate')).toBe(challenge);
}

const INVALID_TOKEN_CHALLENGE = 'Bearer error="invalid_token"';

describe('a refused bearer token (JwtStrategy parity)', () => {
  it('names a session that ended at sign-out', async () => {
    const session = await signIn();
    const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        cookie: session.refreshCookie
      }
    });
    expect(logout.ok).toBe(true);

    await expectRefusal(
      await getProfile(session.accessToken),
      ErrorKeys.AUTH.TOKEN_REVOKED,
      'Session has ended',
      INVALID_TOKEN_CHALLENGE
    );
  });

  it('names a token issued before the revocation of the account', async () => {
    const { accessToken } = await signIn();
    findUserByEmail(USER_EMAIL)!.tokenRevokedAt = new Date(
      Date.now() + 60_000
    ).toISOString();

    await expectRefusal(
      await getProfile(accessToken),
      ErrorKeys.AUTH.TOKEN_REVOKED,
      'Token has been revoked',
      INVALID_TOKEN_CHALLENGE
    );
  });

  it('names a token whose user does not exist', async () => {
    const { accessToken } = await signIn();

    await expectRefusal(
      await getProfile(withClaims(accessToken, { sub: randomUUID() })),
      ErrorKeys.AUTH.USER_NOT_FOUND,
      'User not found',
      'Bearer'
    );
  });

  it.each([
    [{ purpose: TOKEN_PURPOSE.MFA_PENDING }, 'Token is not an access token'],
    [{ sub: '' }, 'Token is missing a valid subject claim'],
    [{ iat: 'now' }, 'Token is missing a valid issued-at claim'],
    [{ sid: undefined }, 'Token is missing a valid session claim']
  ])('names an invalid claim set %j', async (claims, message) => {
    const { accessToken } = await signIn();

    await expectRefusal(
      await getProfile(withClaims(accessToken, claims)),
      ErrorKeys.AUTH.INVALID_TOKEN,
      message,
      INVALID_TOKEN_CHALLENGE
    );
  });

  it('keeps an expired token keyless, as Passport answers it', async () => {
    const { accessToken } = await signIn();

    const res = await getProfile(
      withClaims(accessToken, { exp: Math.floor(Date.now() / 1000) - 1 })
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['message']).toBe('Unauthorized');
    expect(body).not.toHaveProperty('errorKey');
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('sends the key through a permission guard too', async () => {
    const { accessToken } = await signIn();
    findUserByEmail(USER_EMAIL)!.tokenRevokedAt = new Date(
      Date.now() + 60_000
    ).toISOString();

    const res = await fetch(`${baseUrl}/api/v1/users/cursor`, {
      headers: { authorization: `Bearer ${accessToken}` }
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.AUTH.TOKEN_REVOKED
    });
  });
});
