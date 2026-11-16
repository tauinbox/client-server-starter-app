import type { Server } from 'http';
import type { CaptchaConfigResponse } from '@app/shared/types';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
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

async function setCaptcha(body: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}/__control/captcha`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  expect(res.status).toBe(200);
}

async function captchaConfig(): Promise<CaptchaConfigResponse> {
  const res = await fetch(`${baseUrl}/api/v1/auth/captcha-config`);

  expect(res.status).toBe(200);

  return (await res.json()) as CaptchaConfigResponse;
}

// Mirrors CaptchaService.getConfig of the server: a cell with no provider
// names none.
describe('GET /api/v1/auth/captcha-config', () => {
  it('names no provider and no site key while the captcha is off', async () => {
    await expect(captchaConfig()).resolves.toEqual({
      enabled: false,
      provider: null,
      siteKey: null
    });
  });

  it('names the provider and the site key while the captcha is on', async () => {
    await setCaptcha({ enabled: true, siteKey: 'site-1' });

    await expect(captchaConfig()).resolves.toEqual({
      enabled: true,
      provider: 'turnstile',
      siteKey: 'site-1'
    });
  });

  it('drops a site key that the control call sends with the captcha off', async () => {
    await setCaptcha({ enabled: false, siteKey: 'site-1' });

    await expect(captchaConfig()).resolves.toEqual({
      enabled: false,
      provider: null,
      siteKey: null
    });
  });
});
