import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  resetState();
  const app = createApp();
  server = await listenOnUnblockedPort(app);
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetState();
});

async function getConfig(): Promise<unknown> {
  const res = await fetch(`${baseUrl}/api/v1/billing/paddle-config`);
  expect(res.status).toBe(200);
  return res.json();
}

async function setToken(clientToken: unknown): Promise<number> {
  const res = await fetch(`${baseUrl}/__control/billing/paddle-config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientToken })
  });
  return res.status;
}

describe('GET /api/v1/billing/paddle-config', () => {
  it('advertises no client token by default', async () => {
    await expect(getConfig()).resolves.toEqual({
      clientToken: null,
      environment: 'sandbox'
    });
  });

  it('advertises the token that the control route sets', async () => {
    expect(await setToken('test_e2e')).toBe(200);

    await expect(getConfig()).resolves.toEqual({
      clientToken: 'test_e2e',
      environment: 'sandbox'
    });
  });

  it('clears the token again with null', async () => {
    await setToken('test_e2e');
    expect(await setToken(null)).toBe(200);

    await expect(getConfig()).resolves.toMatchObject({ clientToken: null });
  });

  it('rejects a control body without a token', async () => {
    expect(await setToken(undefined)).toBe(400);
  });
});
