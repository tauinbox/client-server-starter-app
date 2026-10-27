import type { FindOptionsWhere } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { ApiError } from '../../../common/errors/api-error';
import type { User } from '../entities/user.entity';

/**
 * An address is taken when another account holds it as its email or as a
 * pending email change: both are reservations on the address.
 */
export function addressTakenWhere(email: string): FindOptionsWhere<User>[] {
  return [{ email }, { pendingEmail: email }];
}

/**
 * The address checks are not atomic with their writes: a concurrent request
 * can claim the same address in between. The unique indexes on email and
 * pending_email reject the loser, and the callers translate that violation into
 * this body, so that the loser gets the same response as the pre-check gives.
 */
export function emailExistsConflict(): ApiError {
  return new ApiError(
    ErrorKeys.USERS.EMAIL_EXISTS,
    'User with this email already exists'
  );
}

export function isEmailExistsConflict(error: unknown): boolean {
  return (
    error instanceof ApiError && error.errorKey === ErrorKeys.USERS.EMAIL_EXISTS
  );
}
