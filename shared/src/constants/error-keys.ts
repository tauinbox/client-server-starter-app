/**
 * Shared error keys used by server (in HttpException responses) and
 * client (as Transloco translation keys). The values are dot-paths
 * into the global `errors.*` namespace of the client i18n JSON files.
 *
 * Server sends `{ message: 'Human-readable fallback', errorKey: ErrorKeys.AUTH.INVALID_CREDENTIALS }`.
 * Client error interceptor resolves the key via Transloco; if no translation
 * is found it falls back to `message`.
 */
export const ErrorKeys = {
  AUTH: {
    INVALID_CREDENTIALS: 'errors.auth.invalidCredentials',
    ACCOUNT_LOCKED: 'errors.auth.accountLocked',
    EMAIL_NOT_VERIFIED: 'errors.auth.emailNotVerified',
    USER_DEACTIVATED: 'errors.auth.userDeactivated',
    USER_NOT_FOUND: 'errors.auth.userNotFound',
    OAUTH_ALREADY_LINKED: 'errors.auth.oauthAlreadyLinked',
    USER_NOT_FOUND_OR_DEACTIVATED: 'errors.auth.userNotFoundOrDeactivated',
    INVALID_VERIFICATION_TOKEN: 'errors.auth.invalidVerificationToken',
    VERIFICATION_TOKEN_EXPIRED: 'errors.auth.verificationTokenExpired',
    INVALID_RESET_TOKEN: 'errors.auth.invalidResetToken',
    RESET_TOKEN_EXPIRED: 'errors.auth.resetTokenExpired',
    INVALID_REFRESH_TOKEN: 'errors.auth.invalidRefreshToken',
    SESSION_INVALIDATED: 'errors.auth.sessionInvalidated',
    TOKEN_REVOKED: 'errors.auth.tokenRevoked',
    TOKEN_INVALIDATED_ROTATION: 'errors.auth.tokenInvalidatedRotation',
    INVALID_OAUTH_PROVIDER: 'errors.auth.invalidOauthProvider',
    MISSING_OAUTH_DATA: 'errors.auth.missingOauthData',
    INVALID_OAUTH_DATA: 'errors.auth.invalidOauthData',
    UNLINK_LAST_PROVIDER: 'errors.auth.unlinkLastProvider',
    INVALID_CURRENT_PASSWORD: 'errors.auth.invalidCurrentPassword'
  },
  USERS: {
    NOT_FOUND: 'errors.users.notFound',
    EMAIL_EXISTS: 'errors.users.emailExists'
  },
  ROLES: {
    NOT_FOUND: 'errors.roles.notFound',
    NAME_EXISTS: 'errors.roles.nameExists',
    CANNOT_MODIFY_SYSTEM: 'errors.roles.cannotModifySystem',
    CANNOT_DELETE_SYSTEM: 'errors.roles.cannotDeleteSystem',
    SUPER_FLAG_FORBIDDEN: 'errors.roles.superFlagForbidden',
    CANNOT_GRANT_PERMISSION: 'errors.roles.cannotGrantPermission'
  },
  ACTIONS: {
    NAME_RESERVED: 'errors.actions.nameReserved',
    NAME_EXISTS: 'errors.actions.nameExists',
    CANNOT_DELETE_DEFAULT: 'errors.actions.cannotDeleteDefault',
    ASSIGNED_TO_ROLES: 'errors.actions.assignedToRoles'
  },
  RESOURCES: {
    NOT_FOUND: 'errors.resources.notFound',
    CANNOT_RESTORE: 'errors.resources.cannotRestore',
    SUBJECT_RESERVED: 'errors.resources.subjectReserved'
  },
  DB: {
    UNIQUE_VIOLATION: 'errors.db.uniqueViolation',
    FOREIGN_KEY_VIOLATION: 'errors.db.foreignKeyViolation',
    NOT_NULL_VIOLATION: 'errors.db.notNullViolation',
    INVALID_INPUT: 'errors.db.invalidInput'
  },
  GENERAL: {
    RESOURCE_NOT_FOUND: 'errors.general.resourceNotFound',
    INTERNAL_SERVER_ERROR: 'errors.general.internalServerError'
  }
} as const;
