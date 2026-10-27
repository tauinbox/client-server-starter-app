import type { Server } from 'http';
import express from 'express';
import { createApp } from '../app';
import { errorEnvelope } from '../helpers/error-envelope.helpers';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';
import { ErrorKeys } from '@app/shared/constants';

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

const TIMESTAMP = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);

function postLogin(body: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  });
}

describe('error envelope (server parity)', () => {
  it('adds error, timestamp and path to a domain error', async () => {
    const res = await postLogin(
      JSON.stringify({ email: 'admin@example.com', password: 'Wrong1xyz' })
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      statusCode: 401,
      message: 'Invalid credentials',
      error: 'Unauthorized',
      timestamp: TIMESTAMP,
      path: '/api/v1/auth/login',
      errorKey: ErrorKeys.AUTH.INVALID_CREDENTIALS
    });
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('challenges a keyless 401 with a bare Bearer', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      headers: { authorization: 'Bearer not-a-token' }
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
  });

  describe('a route body that names a key', () => {
    let probe: Server;
    let probeUrl: string;

    beforeAll(async () => {
      const app = express();
      app.use(errorEnvelope);
      app.get('/key/:key', (req, res) => {
        const body = { message: 'probe', errorKey: req.params['key'] };
        res.status(400).json(body);
      });
      probe = await listenOnUnblockedPort(app);
      probeUrl = baseUrlOf(probe);
    });

    afterAll((done) => {
      probe.close(done);
    });

    it('gets the status of its key, whatever status the route set', async () => {
      const res = await fetch(
        `${probeUrl}/key/${ErrorKeys.AUTH.SESSION_IS_CURRENT}`
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        statusCode: 403,
        error: 'Forbidden',
        errorKey: ErrorKeys.AUTH.SESSION_IS_CURRENT
      });
      expect(res.headers.get('www-authenticate')).toBeNull();
    });

    it('names the invalid token in the challenge of a refused session', async () => {
      const res = await fetch(
        `${probeUrl}/key/${ErrorKeys.AUTH.TOKEN_REVOKED}`
      );
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe(
        'Bearer error="invalid_token"'
      );
    });
  });

  it('answers an unknown route with a JSON 404', async () => {
    const res = await fetch(`${baseUrl}/api/v1/does-not-exist?x=1`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      statusCode: 404,
      message: 'Cannot GET /api/v1/does-not-exist?x=1',
      error: 'Not Found',
      timestamp: TIMESTAMP,
      path: '/api/v1/does-not-exist?x=1'
    });
  });

  it('answers a malformed JSON body with a 400 and the parser message', async () => {
    const res = await postLogin('{bad');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      statusCode: 400,
      message: expect.stringContaining('JSON'),
      error: 'Bad Request',
      timestamp: TIMESTAMP,
      path: '/api/v1/auth/login'
    });
  });

  it('answers a body over the size limit with a 413', async () => {
    const res = await postLogin(JSON.stringify({ email: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      statusCode: 413,
      message: 'request entity too large',
      error: 'Content Too Large',
      timestamp: TIMESTAMP,
      path: '/api/v1/auth/login'
    });
  });
});
