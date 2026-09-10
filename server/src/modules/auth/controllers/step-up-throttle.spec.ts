import { Reflector } from '@nestjs/core';
import {
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS
} from '@app/shared/constants';
import { FAILURE_COUNTER_BODY_FIELDS } from '../../core/failure-counter.decorator';
import { AuthController } from './auth.controller';
import { MfaController } from './mfa.controller';
import { OAuthController } from './oauth.controller';

// The package keeps these metadata keys out of its public entry point.
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';
const LONG_WINDOW = 'login-long-window';

const reflector = new Reflector();

const limitOf = (handler: unknown, name: string): unknown =>
  reflector.get(THROTTLER_LIMIT + name, handler as () => unknown);

const ttlOf = (handler: unknown, name: string): unknown =>
  reflector.get(THROTTLER_TTL + name, handler as () => unknown);

describe('step-up routes', () => {
  describe.each([
    ['setup', MfaController.prototype.setup],
    ['enable', MfaController.prototype.enable],
    ['disable', MfaController.prototype.disable]
  ])('POST /auth/mfa/%s', (_name, handler) => {
    it('costs the caller a budget on every refused attempt', () => {
      expect(limitOf(handler, 'default')).toBe(5);
      expect(limitOf(handler, LONG_WINDOW)).toBe(MAX_FAILED_ATTEMPTS - 1);
      expect(ttlOf(handler, LONG_WINDOW)).toBe(LOCKOUT_DURATION_MS);
    });
  });

  describe.each([
    ['POST /auth/oauth/link-init', OAuthController.prototype.initOAuthLink],
    [
      'DELETE /auth/oauth/accounts/:provider',
      OAuthController.prototype.unlinkOAuth
    ]
  ])('%s', (_name, handler) => {
    it('costs the caller a budget on every refused attempt', () => {
      expect(limitOf(handler, 'default')).toBe(5);
      expect(limitOf(handler, LONG_WINDOW)).toBe(MAX_FAILED_ATTEMPTS - 1);
      expect(ttlOf(handler, LONG_WINDOW)).toBe(LOCKOUT_DURATION_MS);
    });

    it('counts only the requests that carry a password', () => {
      expect(reflector.get(FAILURE_COUNTER_BODY_FIELDS, handler)).toEqual([
        'currentPassword'
      ]);
    });
  });

  describe('PATCH /auth/profile', () => {
    const handler = AuthController.prototype.updateProfile;

    it('counts a refused attempt against the failed-attempt budget', () => {
      expect(limitOf(handler, LONG_WINDOW)).toBe(MAX_FAILED_ATTEMPTS - 1);
      expect(ttlOf(handler, LONG_WINDOW)).toBe(LOCKOUT_DURATION_MS);
    });

    it('counts only the requests that carry a password', () => {
      expect(reflector.get(FAILURE_COUNTER_BODY_FIELDS, handler)).toEqual([
        'password'
      ]);
    });

    it('keeps the application-wide ceiling for every other field', () => {
      expect(limitOf(handler, 'default')).toBeUndefined();
    });
  });
});
