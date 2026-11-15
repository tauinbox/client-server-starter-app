import { randomUUID } from 'crypto';
import {
  ERROR_STATUS,
  ErrorKeys,
  isCountryCode,
  type CountryCode
} from '@app/shared/constants';
import { normalizeEmail } from '@app/shared/utils/email';
import {
  emailErrors,
  nameErrors,
  newPasswordErrors,
  stringErrors,
  trimName,
  unknownPropertyErrors,
  validateLocale
} from '../utils/validation';
import { findUserByEmail, findUserByPendingEmail } from '../state';
import { validationError, validationStatus } from './validation-error.helpers';
import { newPasswordRefusal } from './breached-password.helpers';
import { residenceRefusal } from './region.helpers';
import type { MockUser } from '../types';

export interface CreateUserFields {
  email: string;
  name: string;
  password: string;
  locale: string;
}

interface ConflictEnvelope {
  message: string;
  errorKey: string;
}

type CreateUserResult =
  | { ok: true; fields: CreateUserFields }
  | {
      ok: false;
      status: number;
      body: ReturnType<typeof validationError> | ConflictEnvelope;
    };

type RegisterResult =
  | {
      ok: true;
      fields: CreateUserFields & { residenceCountry: CountryCode };
    }
  | Extract<CreateUserResult, { ok: false }>;

type CreateUserDtoResult =
  | { ok: true; fields: CreateUserFields }
  | { ok: false; status: number; body: ReturnType<typeof validationError> };

interface CreateUserConflict {
  status: number;
  body: ReturnType<typeof validationError> | ConflictEnvelope;
}

const CREATE_USER_KEYS = ['email', 'name', 'password', 'locale'] as const;

/** The `@MaxLength` of `RegisterDto.captchaToken`. */
const MAX_CAPTCHA_TOKEN_LENGTH = 2048;

/**
 * Validates the `CreateUserDto` fields after `leadingErrors`, which hold the
 * unknown properties and the fields of a subclass: class-validator reports
 * them first. Every field fails on its own, so one body can carry the errors
 * of all of them.
 */
function createUserDtoResult(
  body: Record<string, unknown>,
  leadingErrors: string[]
): CreateUserDtoResult {
  const name = trimName(body['name']);
  const { password, locale } = body;
  const localeError = validateLocale(locale);
  const errors = [
    ...leadingErrors,
    ...emailErrors('email', body['email']),
    ...nameErrors(name),
    ...newPasswordErrors(password),
    ...(localeError ? [localeError] : [])
  ];

  if (errors.length > 0) {
    return {
      ok: false,
      status: validationStatus('body'),
      body: validationError(errors)
    };
  }

  // Each check above rejects a non-string value.
  const fields: CreateUserFields = {
    email: String(normalizeEmail(body['email'])),
    name: String(name),
    password: String(password),
    locale: typeof locale === 'string' ? locale : 'en'
  };

  return { ok: true, fields };
}

/**
 * The `CreateUserDto` stage. The server runs it in the global pipe, above the
 * ability check, so the admin route places its instance check between this and
 * `findCreateUserConflict`.
 */
export function validateCreateUserDto(
  body: Record<string, unknown>
): CreateUserDtoResult {
  return createUserDtoResult(
    body,
    unknownPropertyErrors(body, CREATE_USER_KEYS)
  );
}

/**
 * The `UsersService.create` stage. The server runs it below the ability check,
 * and answers the blocklist ahead of the address conflict, so both create
 * routes answer the same way for the same body.
 */
export function findCreateUserConflict(
  fields: CreateUserFields
): CreateUserConflict | null {
  const passwordRefusal = newPasswordRefusal(fields.password, fields);

  if (passwordRefusal) {
    return {
      status: ERROR_STATUS[passwordRefusal.errorKey],
      body: passwordRefusal
    };
  }

  if (findUserByEmail(fields.email) || findUserByPendingEmail(fields.email)) {
    return {
      status: ERROR_STATUS[ErrorKeys.USERS.EMAIL_EXISTS],
      body: {
        message: 'User with this email already exists',
        errorKey: ErrorKeys.USERS.EMAIL_EXISTS
      }
    };
  }

  return null;
}

/** The `@IsIn` message of `RegisterDto.residenceCountry`. */
export const RESIDENCE_COUNTRY_ERROR =
  'residenceCountry must be an ISO 3166-1 alpha-2 country code';

/**
 * Both stages in one call, for `POST /auth/register`. That route is public, so
 * it has no ability check to place between them. Its `RegisterDto` adds
 * `captchaToken` and `residenceCountry` to the `CreateUserDto` fields, and
 * `AuthService.register` checks the region of the country first.
 */
export function validateCreateUserBody(
  body: Record<string, unknown>
): RegisterResult {
  const { residenceCountry } = body;
  const validated = createUserDtoResult(body, [
    ...unknownPropertyErrors(body, [
      ...CREATE_USER_KEYS,
      'captchaToken',
      'residenceCountry'
    ]),
    ...stringErrors('captchaToken', body['captchaToken'], {
      max: MAX_CAPTCHA_TOKEN_LENGTH,
      optional: 'nullable'
    }),
    ...(isCountryCode(residenceCountry) ? [] : [RESIDENCE_COUNTRY_ERROR])
  ]);

  if (!validated.ok) return validated;

  // The validation above rejects any other value.
  const country = residenceCountry as CountryCode;
  const refusal = residenceRefusal(country);

  if (refusal) {
    return { ok: false, status: ERROR_STATUS[refusal.errorKey], body: refusal };
  }

  const conflict = findCreateUserConflict(validated.fields);

  if (conflict) {
    return { ok: false, status: conflict.status, body: conflict.body };
  }

  return {
    ok: true,
    fields: { ...validated.fields, residenceCountry: country }
  };
}

/**
 * `isEmailVerified` is the one field the two create paths disagree on: a
 * self-registered user has to verify, an admin-created one is trusted. Only a
 * self-registration declares a country of residence.
 */
export function buildMockUser(
  fields: CreateUserFields,
  options: { isEmailVerified: boolean; residenceCountry: CountryCode | null }
): MockUser {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    email: fields.email,
    name: fields.name,
    password: fields.password, // Stored as plaintext - mock only. Real server uses bcrypt.
    isActive: true,
    roles: ['user'],
    isEmailVerified: options.isEmailVerified,
    locale: fields.locale,
    residenceCountry: options.residenceCountry,
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
