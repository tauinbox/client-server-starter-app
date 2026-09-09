import { v4 as uuidv4 } from 'uuid';
import { ErrorKeys } from '@app/shared/constants';
import { normalizeEmail } from '@app/shared/utils/email';
import {
  isValidEmail,
  passwordLengthError,
  validateLocale,
  validateMaxLength
} from '../utils/validation';
import { findUserByEmail, findUserByPendingEmail } from '../state';
import { validationError } from './validation-error.helpers';
import {
  breachedPasswordEnvelope,
  isBreachedPassword
} from './breached-password.helpers';
import type { MockUser } from '../types';

export interface CreateUserFields {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  locale: string;
}

interface ConflictEnvelope {
  message: string;
  statusCode: number;
  errorKey: string;
}

type CreateUserResult =
  | { ok: true; fields: CreateUserFields }
  | {
      ok: false;
      status: number;
      body: ReturnType<typeof validationError> | ConflictEnvelope;
    };

type CreateUserDtoResult =
  | { ok: true; fields: CreateUserFields }
  | { ok: false; status: number; body: ReturnType<typeof validationError> };

interface CreateUserConflict {
  status: number;
  body: ReturnType<typeof validationError> | ConflictEnvelope;
}

/**
 * The `CreateUserDto` stage. The server runs it in the global pipe, above the
 * ability check, so the admin route places its instance check between this and
 * `findCreateUserConflict`.
 */
export function validateCreateUserDto(
  body: Record<string, unknown>
): CreateUserDtoResult {
  const email = normalizeEmail(body['email']) ?? '';
  const { firstName, lastName, password, locale } = body;

  if (!email || !firstName || !lastName || !password) {
    return {
      ok: false,
      status: 400,
      body: validationError('All fields are required')
    };
  }

  if (!isValidEmail(email)) {
    return {
      ok: false,
      status: 400,
      body: validationError('email must be an email')
    };
  }

  const lengthErr =
    validateMaxLength(email, 255, 'email') ||
    validateMaxLength(firstName, 255, 'firstName') ||
    validateMaxLength(lastName, 255, 'lastName') ||
    passwordLengthError(password);
  if (lengthErr) {
    return { ok: false, status: 400, body: validationError(lengthErr) };
  }

  const localeErr = validateLocale(locale);
  if (localeErr) {
    return { ok: false, status: 400, body: validationError(localeErr) };
  }

  // Every field above cleared a length check, which rejects non-strings.
  const fields: CreateUserFields = {
    email,
    firstName: String(firstName),
    lastName: String(lastName),
    password: String(password),
    locale: typeof locale === 'string' ? locale : 'en'
  };

  return { ok: true, fields };
}

/**
 * The `UsersService.create` stage. The server runs it below the ability check,
 * and answers the blocklist ahead of the address conflict, so both create
 * routes answer the same way for the same body.
 */
export function findCreateUserConflict(
  fields: CreateUserFields
): CreateUserConflict | null {
  if (isBreachedPassword(fields.password)) {
    return { status: 400, body: breachedPasswordEnvelope() };
  }

  if (findUserByEmail(fields.email) || findUserByPendingEmail(fields.email)) {
    return {
      status: 409,
      body: {
        message: 'User with this email already exists',
        statusCode: 409,
        errorKey: ErrorKeys.USERS.EMAIL_EXISTS
      }
    };
  }

  return null;
}

/**
 * Both stages in one call, for `POST /auth/register`. That route is public, so
 * it has no ability check to place between them.
 */
export function validateCreateUserBody(
  body: Record<string, unknown>
): CreateUserResult {
  const validated = validateCreateUserDto(body);
  if (!validated.ok) return validated;

  const conflict = findCreateUserConflict(validated.fields);
  if (conflict) {
    return { ok: false, status: conflict.status, body: conflict.body };
  }

  return validated;
}

/**
 * `isEmailVerified` is the one field the two create paths disagree on: a
 * self-registered user has to verify, an admin-created one is trusted.
 */
export function buildMockUser(
  fields: CreateUserFields,
  options: { isEmailVerified: boolean }
): MockUser {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    email: fields.email,
    firstName: fields.firstName,
    lastName: fields.lastName,
    password: fields.password, // Stored as plaintext - mock only. Real server uses bcrypt.
    isActive: true,
    roles: ['user'],
    isEmailVerified: options.isEmailVerified,
    locale: fields.locale,
    failedLoginAttempts: 0,
    lockedUntil: null,
    tokenRevokedAt: null,
    totpSecret: null,
    totpEnabledAt: null,
    totpRecoveryCodes: null,
    totpLastUsedStep: null,
    pendingEmail: null,
    pendingEmailToken: null,
    pendingEmailExpiresAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
}
