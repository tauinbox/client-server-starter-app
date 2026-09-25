import { ErrorKeys } from '@app/shared/constants';
import {
  localPasswordRefusal,
  PASSWORD_TOO_COMMON_MESSAGE
} from '@app/shared/utils/password-policy';
import type { PasswordContext } from '@app/shared/utils/password-policy';
import { getState } from '../state';

export const BREACHED_PASSWORD_MESSAGE =
  'This password has appeared in a public data breach. Please choose a different one.';

interface PasswordRefusalEnvelope {
  message: string;
  statusCode: number;
  errorKey: string;
}

/**
 * Byte-for-byte the body `BreachedPasswordService.assertNotBreached` throws,
 * in the same order: the local check first, then the breach corpus that
 * stands in for the range lookup. `null` when the password may be set.
 */
export function newPasswordRefusal(
  password: unknown,
  context: PasswordContext
): PasswordRefusalEnvelope | null {
  if (typeof password !== 'string') return null;

  if (localPasswordRefusal(password, context)) {
    return {
      message: PASSWORD_TOO_COMMON_MESSAGE,
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.PASSWORD_TOO_COMMON
    };
  }

  if (getState().breachedPasswords.has(password)) {
    return {
      message: BREACHED_PASSWORD_MESSAGE,
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.PASSWORD_BREACHED
    };
  }

  return null;
}
