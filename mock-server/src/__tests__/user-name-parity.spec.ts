import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';

// The server trims `name` and refuses an empty result on every user DTO.

let server: Server;
let baseUrl: string;

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

async function adminToken(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function send(
  method: string,
  path: string,
  body: unknown,
  token?: string
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

const NEW_USER = { password: 'Lantern-Orchard-47', locale: 'en' };

describe('the user name', () => {
  it('is trimmed on register', async () => {
    const res = await send('POST', '/auth/register', {
      ...NEW_USER,
      email: 'trimmed@example.com',
      name: '  Ada Lovelace  '
    });

    expect(res.status).toBe(201);
    expect(findUserByEmail('trimmed@example.com')?.name).toBe('Ada Lovelace');
  });

  it('is trimmed on an admin create', async () => {
    const res = await send(
      'POST',
      '/users',
      { ...NEW_USER, email: 'created@example.com', name: '  Madonna ' },
      await adminToken()
    );

    expect(res.status).toBe(201);
    expect(findUserByEmail('created@example.com')?.name).toBe('Madonna');
  });

  it('refuses a name of spaces on an admin update and keeps the record', async () => {
    const id = mockId('user-3');
    const res = await send(
      'PATCH',
      `/users/${id}`,
      { name: '   ' },
      await adminToken()
    );

    expect(res.status).toBe(422);
    expect(((await res.json()) as { errors: string[] }).errors).toEqual([
      'name should not be empty'
    ]);
    expect(getState().users.get(id)?.name).toBe('John Smith');
  });

  it('is trimmed on an admin update', async () => {
    const id = mockId('user-3');
    const res = await send(
      'PATCH',
      `/users/${id}`,
      { name: ' Jon Smith ' },
      await adminToken()
    );

    expect(res.status).toBe(200);
    expect(getState().users.get(id)?.name).toBe('Jon Smith');
  });
});
