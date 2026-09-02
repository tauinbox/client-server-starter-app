import { SetMetadata } from '@nestjs/common';

export const SKIP_MFA_ENROLMENT_GATE_KEY = 'skip_mfa_enrolment_gate';

/**
 * Keeps one `@Authorize` route reachable for an account that still owes its
 * two-factor enrolment.
 *
 * The gate exists to shut the administration surface, not the account's own
 * credentials. An account created through a provider holds no password, and
 * enrolment needs a step-up it can only satisfy with one, so it must be able
 * to set a password first. That route is `PATCH /auth/profile`, and it carries
 * `@Authorize(['update', 'Profile'])` because a profile update is still an
 * authorization decision. Without this marker the account would be told to
 * enrol and refused the one route that lets it.
 *
 * Use it only for a route that manages the caller's own account.
 */
export const SkipMfaEnrolmentGate = () =>
  SetMetadata(SKIP_MFA_ENROLMENT_GATE_KEY, true);
