/**
 * Compile-time contract for the User entity.
 *
 * Every field declared in User must fall into exactly one of three categories:
 *
 *   1. PUBLIC  — present in UserResponse (the API wire format)
 *   2. EXCLUDED — decorated with @Exclude() in user.entity.ts
 *   3. TRANSFORMED — a TypeORM relation projected differently in the response
 *                   (e.g. Role[] serialised as string[] by the service layer)
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
 *   - If it is a relation with a custom projection → add it to
 *     _TransformedRelations below with a comment explaining the mapping.
 */

import type { User } from './user.entity';
import type { UserResponse, _AssertNever } from '@app/shared/types';

/**
 * Fields excluded from the base UserResponse wire format.
 * Includes both @Exclude()-decorated fields and admin-only fields
 * (failedLoginAttempts, lockedUntil) that are exposed only via AdminUserResponseDto.
 */
type _ExcludedFields =
  | 'password'
  | 'emailVerificationToken'
  | 'emailVerificationExpiresAt'
  | 'passwordResetToken'
  | 'passwordResetExpiresAt'
  | 'tokenRevokedAt'
  | 'failedLoginAttempts'
  | 'lockedUntil';

/**
 * TypeORM relations whose runtime value differs from the shared response type.
 * These are intentionally absent from UserResponse under the same key shape.
 *   roles: Role[]  →  projected as string[] (role names) in service/response
 */
type _TransformedRelations = 'roles';

// ── Coverage checks ──────────────────────────────────────────────────────────

/**
 * Every User field must be in UserResponse, _ExcludedFields, or
 * _TransformedRelations. A non-`never` result means a field is unaccounted for.
 */
type _EntityFieldCoverage = _AssertNever<
  Exclude<
    keyof User,
    keyof UserResponse | _ExcludedFields | _TransformedRelations
  >
>;

/**
 * Every UserResponse field must exist on the User entity.
 * A non-`never` result means the shared type references a field the entity lacks.
 */
type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof UserResponse, keyof User>
>;
