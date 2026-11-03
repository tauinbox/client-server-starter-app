import { SetMetadata } from '@nestjs/common';

export const SKIP_MFA_ENROLMENT_GATE_KEY = 'skip_mfa_enrolment_gate';

/**
 * Keeps an `@Authorize` route reachable for an account that still owes its
 * two-factor enrolment.
 *
 * The gate exists to shut the administration surface, not the account's own
 * credentials. The two profile writes, `PATCH /auth/profile` and
 * `POST /auth/profile/email/initiate`, carry `@Authorize(['update', 'Profile'])`
 * because a profile update is still an authorization decision. Without this
 * marker an account that owes its enrolment could not change its password or
 * its address until it enrols.
 *
 * Use it only for a route that manages the caller's own account.
 */
export const SkipMfaEnrolmentGate = () =>
  SetMetadata(SKIP_MFA_ENROLMENT_GATE_KEY, true);
