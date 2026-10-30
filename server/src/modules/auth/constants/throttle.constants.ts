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
 * The two-factor, provider-link, provider-unlink and session-revocation routes
 * carry this. Three routes that verify a secret set their own limits: the
 * login, the profile update (the long window only) and the email-change
 * initiation (3 per hour). `ThrottlerGuard.generateKey` hashes the handler name
 * into the storage key, so each route keeps a counter of its own.
 *
 * Each step-up route takes this throttle through `@StepUpRoute`, which also
 * applies `@CountFailuresOnlyWhenBody`: an account with no password proves
 * itself with the `reauth_proof` cookie, and a request that presents no secret
 * must not spend the budget that guards one.
 */
export const CHALLENGE_THROTTLE = {
  default: { ttl: 60000, limit: 5 },
  'login-long-window': {
    ttl: LOCKOUT_DURATION_MS,
    limit: MAX_FAILED_ATTEMPTS - 1
  }
};
