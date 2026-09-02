import { ErrorKeys } from '@app/shared/constants';
import { getState } from '../state';

export const BREACHED_PASSWORD_MESSAGE =
  'This password has appeared in a public data breach. Please choose a different one.';

/** Byte-for-byte the body `BreachedPasswordService.assertNotBreached` throws. */
export function breachedPasswordEnvelope(): {
  message: string;
  statusCode: number;
  errorKey: string;
} {
  return {
    message: BREACHED_PASSWORD_MESSAGE,
    statusCode: 400,
    errorKey: ErrorKeys.AUTH.PASSWORD_BREACHED
  };
}

export function isBreachedPassword(password: unknown): boolean {
  return (
    typeof password === 'string' && getState().breachedPasswords.has(password)
  );
}
