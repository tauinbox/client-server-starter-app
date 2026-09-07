import {
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS
} from '@app/shared/constants';

/**
 * A wrong secret must cost the attacker something: six digits is a million
 * guesses, and a password is worth more, which an unthrottled route walks in
 * minutes. The long window is the same one the login route uses, and it
 * refunds itself on success, so only failures accumulate.
 *
 * Every route that verifies a secret carries this, the enrolment, the step-up
 * and the provider-link ones included. `ThrottlerGuard.generateKey` hashes the
 * handler name into the storage key, so each route keeps a counter of its own.
 */
export const CHALLENGE_THROTTLE = {
  default: { ttl: 60000, limit: 5 },
  'login-long-window': {
    ttl: LOCKOUT_DURATION_MS,
    limit: MAX_FAILED_ATTEMPTS - 1
  }
};
