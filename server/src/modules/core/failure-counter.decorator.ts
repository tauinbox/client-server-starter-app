import { SetMetadata } from '@nestjs/common';

export const FAILURE_COUNTER_BODY_FIELDS = 'failure-counter-body-fields';

/**
 * Restricts the `login-long-window` failure counter to the requests that carry
 * one of the named body fields. A route that verifies a secret beside fields
 * that verify none needs this: `PATCH /auth/profile` changes a password and a
 * display name through one handler, and a name change must never spend the
 * budget that guards the password.
 *
 * The counter is the only throttler this affects. Every other limit on the
 * route, the application-wide default included, still applies to every
 * request.
 */
export const CountFailuresOnlyWhenBody = (
  ...fields: string[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(FAILURE_COUNTER_BODY_FIELDS, fields);
