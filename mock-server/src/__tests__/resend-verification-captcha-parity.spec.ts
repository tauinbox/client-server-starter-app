import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';

let server: Server;
let baseUrl: string;

const email = 'user@example.com';

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
  const user = findUserByEmail(email);
  expect(user).toBeDefined();
  user!.isEmailVerified = false;
});

function resend(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/resend-verification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function enableCaptcha(): void {
  getState().captchaConfig = { enabled: true, siteKey: 'test-site-key' };
}

// The server gates the route with CaptchaRequiredGuard behind
// @Throttle({ ttl: 60000, limit: 3 }), and the guard asks for a token once
// X-RateLimit-Remaining drops to 1. The mock reproduces that budget.
describe('resend-verification captcha gate', () => {
  it('sets the rate-limit headers the gate reads', async () => {
    const res = await resend({ email });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-ratelimit-limit')).toBe('3');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('2');
  });

  it('asks for a token on the call that reaches the threshold', async () => {
    enableCaptcha();

    const first = await resend({ email });
    expect(first.status).toBe(200);

    const second = await resend({ email });
    expect(second.status).toBe(400);
    expect(await second.json()).toEqual({
      message: 'Captcha verification is required',
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.CAPTCHA_REQUIRED
    });
  });

  it('accepts the same call when a token rides along', async () => {
    enableCaptcha();

    await resend({ email });
    const second = await resend({ email, captchaToken: 'test-token' });

    expect(second.status).toBe(200);
  });

  it('rotates no token on the call the gate refuses', async () => {
    enableCaptcha();

    await resend({ email });
    const issued = [...getState().emailVerificationTokens.keys()];
    expect(issued).toHaveLength(1);

    const refused = await resend({ email });
    expect(refused.status).toBe(400);
    expect([...getState().emailVerificationTokens.keys()]).toEqual(issued);
  });

  it('demands nothing while captcha is disabled', async () => {
    for (let i = 0; i < 4; i++) {
      const res = await resend({ email });
      expect(res.status).toBe(200);
    }
  });
});
