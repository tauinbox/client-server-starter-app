import type { Server } from 'http';
import request from 'supertest';
import type { CountryCode } from '@app/shared/constants';

/**
 * The `oauth_signup` cookie that a provider callback set for an identity that
 * no account holds, as a `name=value` pair. The name carries the `__Host-`
 * prefix outside `local`, so both forms are accepted.
 */
export function oauthSignupCookie(callbackResponse: request.Response): string {
  const header = callbackResponse.headers['set-cookie'] as
    string[] | string | undefined;
  const lines = Array.isArray(header) ? header : [header ?? ''];
  const cookie = lines
    .find((line) => /^(__Host-)?oauth_signup=/.test(line))
    ?.split(';')[0];

  if (!cookie) throw new Error('the callback set no oauth_signup cookie');

  return cookie;
}

/**
 * Declares the country of residence for the identity of the callback, which
 * creates the account and signs it in.
 */
export function completeOAuthSignup(
  server: Server,
  callbackResponse: request.Response,
  {
    residenceCountry = 'DE',
    requestId
  }: { residenceCountry?: CountryCode; requestId?: string } = {}
): request.Test {
  const req = request(server)
    .post('/api/v1/auth/oauth/signup')
    .set('Cookie', oauthSignupCookie(callbackResponse))
    .send({ residenceCountry });

  return requestId ? req.set('X-Request-Id', requestId) : req;
}
