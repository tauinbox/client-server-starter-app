import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp } from '../app';
import { resetState } from '../state';

let server: Server;
let baseUrl: string;

beforeAll((done) => {
  resetState();
  const app = createApp();
  server = app.listen(0, () => {
    const addr = server.address() as AddressInfo;
    baseUrl = `http://localhost:${addr.port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetState();
});

async function loginAsAdmin(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'Password1'
    })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

describe('PATCH /api/v1/users/:id email-change parity with server', () => {
  it('returns 409 with errorKey + field on duplicate email', async () => {
    const token = await loginAsAdmin();

    // user '3' (john@example.com) trying to take user '5' (bob@example.com)
    const res = await fetch(`${baseUrl}/api/v1/users/3`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ email: 'bob@example.com' })
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      errorKey: string;
      field: string;
      message: string;
    };
    expect(body.errorKey).toBe('errors.users.emailExists');
    expect(body.field).toBe('email');
  });

  it('resets isEmailVerified when email changes', async () => {
    const token = await loginAsAdmin();

    const res = await fetch(`${baseUrl}/api/v1/users/3`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ email: 'changed@example.com' })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      email: string;
      isEmailVerified: boolean;
    };
    expect(body.email).toBe('changed@example.com');
    expect(body.isEmailVerified).toBe(false);
  });

  it('does not reset isEmailVerified when email is unchanged', async () => {
    const token = await loginAsAdmin();

    const res = await fetch(`${baseUrl}/api/v1/users/3`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ email: 'john@example.com', firstName: 'Johnny' })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { isEmailVerified: boolean };
    expect(body.isEmailVerified).toBe(true);
  });
});
