/**
 * Compile-time contract for the User entity.
 *
 * Every field declared in User must fall into exactly one of two categories:
 *
 *   1. PUBLIC  — present in UserResponse (the API wire format). Relations
 *                (e.g. roles: Role[]) are serialised by ClassSerializerInterceptor
 *                to their corresponding response type (RoleResponse[]).
 *   2. EXCLUDED — decorated with @Exclude() in user.entity.ts
 *
 * If a field is added to User without being placed into one of these lists,
 * the type alias below resolves to a non-`never` type and the file fails to
 * compile, surfacing the omission at build time.
 *
 * When you add a field to User:
 *   - If it should appear in API responses → add it to UserResponse in
 *     shared/src/types/user.types.ts and to UserResponseDto.
 *   - If it is internal / sensitive → add @Exclude() to the entity field
 *     AND add its name to _ExcludedFields below.
 */

import type { User } from './user.entity';
import type { UserResponse, _AssertNever } from '@app/shared/types';

/**
 * Fields excluded from the base UserResponse wire format.
 * - @Exclude()-decorated fields are never serialised (password, tokens, failedLoginAttempts).
 * - lockedUntil is gated by @Expose({ groups: ['privileged'] }) and surfaces only via
 *   AdminUserResponseDto on endpoints with @SerializeOptions({ groups: ['privileged'] }).
 */
type _ExcludedFields =
  | 'password'
  | 'emailVerificationToken'
  | 'emailVerificationExpiresAt'
  | 'passwordResetToken'
  | 'passwordResetExpiresAt'
  | 'pendingEmail'
  | 'pendingEmailToken'
  | 'pendingEmailExpiresAt'
  | 'tokenRevokedAt'
  | 'failedLoginAttempts'
  | 'lockedUntil';

// ── Coverage checks ──────────────────────────────────────────────────────────

/**
 * Every User field must be in UserResponse or _ExcludedFields.
 * A non-`never` result means a field is unaccounted for.
 */
type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof User, keyof UserResponse | _ExcludedFields>
>;

/**
 * Every UserResponse field must exist on the User entity.
 * A non-`never` result means the shared type references a field the entity lacks.
 */
type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof UserResponse, keyof User>
>;
