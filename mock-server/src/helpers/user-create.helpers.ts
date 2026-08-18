import { v4 as uuidv4 } from 'uuid';
import {
  ErrorKeys,
  PASSWORD_ERROR,
  PASSWORD_REGEX
} from '@app/shared/constants';
import { normalizeEmail } from '@app/shared/utils/email';
import {
  isValidEmail,
  passwordLengthError,
  validateLocale,
  validateMaxLength
} from '../utils/validation';
import { findUserByEmail, findUserByPendingEmail } from '../state';
import { validationError } from './validation-error.helpers';
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

/**
 * The `CreateUserDto` validation and the email-conflict check shared by
 * `POST /auth/register` and the admin `POST /users`. Both hit the same DTO on
 * the real server, so the checks and their order have to stay identical; all
 * that differs is what each caller does with the validated fields.
 */
export function validateCreateUserBody(
  body: Record<string, unknown>
): CreateUserResult {
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

  // Every field above cleared a length check, which rejects non-strings.
  const fields: CreateUserFields = {
    email,
    firstName: String(firstName),
    lastName: String(lastName),
    password: String(password),
    locale: typeof locale === 'string' ? locale : 'en'
  };

  if (!PASSWORD_REGEX.test(fields.password)) {
    return { ok: false, status: 400, body: validationError(PASSWORD_ERROR) };
  }

  const localeErr = validateLocale(locale);
  if (localeErr) {
    return { ok: false, status: 400, body: validationError(localeErr) };
  }

  if (findUserByEmail(email) || findUserByPendingEmail(email)) {
    return {
      ok: false,
      status: 409,
      body: {
        message: 'User with this email already exists',
        statusCode: 409,
        errorKey: ErrorKeys.USERS.EMAIL_EXISTS
      }
    };
  }

  return { ok: true, fields };
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
    pendingEmail: null,
    pendingEmailToken: null,
    pendingEmailExpiresAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
}
