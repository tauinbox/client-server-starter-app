import { Router } from 'express';
import {
  ALLOWED_USER_SORT_COLUMNS,
  ErrorKeys,
  MAX_USER_FILTER_LENGTH,
  STEP_UP_OPERATION,
  TOTP_DIGITS
} from '@app/shared/constants';
import { normalizeEmail } from '@app/shared/utils/email';
import {
  breachedPasswordEnvelope,
  isBreachedPassword
} from '../helpers/breached-password.helpers';
import {
  emailErrors,
  passwordLengthError,
  validateLocale,
  validateMaxLength
} from '../utils/validation';
import {
  cursorPaginate,
  cursorQueryErrors,
  parseCursorQuery
} from '../helpers/pagination.helpers';
import {
  findUserByEmail,
  findUserById,
  findUserByIdWithDeleted,
  getPackedRulesForUser,
  getResolvedPermissionsForUser,
  getState,
  logAudit,
  toAdminUserResponse
} from '../state';
import {
  assertCanWriteUser,
  assertInstancePermission,
  clearMailedProofs,
  permissionGuard
} from '../helpers/auth.helpers';
import {
  buildMockUser,
  findCreateUserConflict,
  validateCreateUserDto
} from '../helpers/user-create.helpers';
import {
  isValidCodeShape,
  isValidPasswordShape,
  sendWithRetryAfter,
  stepUpError
} from '../helpers/reauth.helpers';
import { cancelSubscriptionsForDeletedUser } from './billing.middleware';
import type { AuthenticatedRequest, MockUser } from '../types';
import { pushToUser, pushToUsersMatching } from '../sse-hub';
import {
  requireUuid,
  validationError
} from '../helpers/validation-error.helpers';

type UserCrudAction = 'created' | 'updated' | 'deleted' | 'restored';

// user_crud_events only drive the admin user list, so they are limited to
// clients that may list users - a broadcast would leak user IDs and the fact
// that an account was created/updated/deleted to every authenticated client.
function pushUserCrudEvent(action: UserCrudAction, userId: string): void {
  pushToUsersMatching(
    (connectedUserId) =>
      findUserById(connectedUserId)?.roles?.includes('admin') === true,
    { type: 'user_crud_events', action, userId }
  );
}

// Mirrors the server's session-revocation listener: the stamp alone kills
// access tokens only, and dropping the refresh rows alone leaves issued access
// tokens valid until they expire, so both legs are required.
function revokeUserSessions(user: MockUser): void {
  user.tokenRevokedAt = new Date().toISOString();
  const sessionState = getState();
  for (const [token, uid] of sessionState.refreshTokens.entries()) {
    if (uid === user.id) {
      sessionState.refreshTokens.delete(token);
    }
  }
  for (const [token, uid] of sessionState.revokedRefreshTokens.entries()) {
    if (uid === user.id) {
      sessionState.revokedRefreshTokens.delete(token);
    }
  }
}

// Mirrors the real server's UserFiltersQueryDto: an array-valued query param
// (?q[]=a&q[]=b) must be rejected 400 rather than coerced, a filter longer
// than the shared cap is a 400, and a boolean param that spells neither
// "true" nor "false" is a 400 rather than a silently dropped filter.
const STRING_FILTER_PARAMS = ['q', 'email', 'firstName', 'lastName', 'role'];
const BOOLEAN_FILTER_PARAMS = ['isActive', 'includeDeleted'];

/** Filters the user list routes carry on top of the shared paging params. */
const USER_QUERY_KEYS = [...STRING_FILTER_PARAMS, ...BOOLEAN_FILTER_PARAMS];

/** Mirrors the DTO's boolean @Transform: an empty param reads as unset. */
function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return undefined;
}

function findFilterValidationError(
  query: Record<string, unknown>
): string | null {
  for (const key of STRING_FILTER_PARAMS) {
    const value = query[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') return `${key} must be a string`;
    if (value.length > MAX_USER_FILTER_LENGTH) {
      return `${key} must be shorter than or equal to ${MAX_USER_FILTER_LENGTH} characters`;
    }
  }

  for (const key of BOOLEAN_FILTER_PARAMS) {
    const value = query[key];
    if (value === undefined || value === '') continue;
    if (parseOptionalBoolean(value) === undefined) {
      return `${key} must be a boolean value`;
    }
  }

  return null;
}

/**
 * Every user list route validates the shared paging params on top of its own
 * filters. Filter messages come first so the existing envelope order is
 * unchanged for a request that only trips a filter rule.
 */
function userQueryErrors(query: Record<string, unknown>): string[] {
  const filterError = findFilterValidationError(query);
  const pagingErrors = cursorQueryErrors(query, {
    extraAllowed: USER_QUERY_KEYS,
    sortColumns: ALLOWED_USER_SORT_COLUMNS
  });
  return filterError ? [filterError, ...pagingErrors] : pagingErrors;
}

const router = Router();

// POST /api/v1/users
router.post('/', permissionGuard('create', 'User'), (req, res) => {
  const validated = validateCreateUserDto(req.body);
  if (!validated.ok) {
    res.status(validated.status).json(validated.body);
    return;
  }

  // The password is left out of the subject on purpose: no authorization
  // condition can legitimately be written over it.
  const { password: _password, ...subjectFields } = validated.fields;
  if (!assertInstancePermission(req, res, 'create', 'User', subjectFields)) {
    return;
  }

  const conflict = findCreateUserConflict(validated.fields);
  if (conflict) {
    res.status(conflict.status).json(conflict.body);
    return;
  }

  const user = buildMockUser(validated.fields, { isEmailVerified: true });

  getState().users.set(user.id, user);

  const actor = (req as AuthenticatedRequest).user;
  logAudit('USER_CREATE', {
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: user.id,
    targetType: 'User',
    ip: req.ip
  });

  pushUserCrudEvent('created', user.id);
  res.status(201).json(toAdminUserResponse(user));
});

// GET /api/v1/users/cursor
router.get('/cursor', permissionGuard('search', 'User'), (req, res) => {
  const queryErrors = userQueryErrors(req.query as Record<string, unknown>);
  if (queryErrors.length > 0) {
    res.status(400).json(validationError(queryErrors));
    return;
  }
  const includeDeleted = String(req.query['includeDeleted']) === 'true';
  let allUsers = Array.from(getState().users.values());
  if (!includeDeleted) {
    allUsers = allUsers.filter((u) => !u.deletedAt);
  }
  const users = allUsers.map(toAdminUserResponse);
  const params = parseCursorQuery(req.query as Record<string, unknown>);
  const result = cursorPaginate(users, params);
  res.json(result);
});

// GET /api/v1/users/search/cursor
router.get('/search/cursor', permissionGuard('search', 'User'), (req, res) => {
  const queryErrors = userQueryErrors(req.query as Record<string, unknown>);
  if (queryErrors.length > 0) {
    res.status(400).json(validationError(queryErrors));
    return;
  }
  const { q, email, firstName, lastName, role, isActive } = req.query;
  const includeDeleted = String(req.query['includeDeleted']) === 'true';
  let users = Array.from(getState().users.values());

  if (!includeDeleted) {
    users = users.filter((u) => !u.deletedAt);
  }

  if (q) {
    const qStr = String(q).toLowerCase();
    users = users.filter(
      (u) =>
        u.email.toLowerCase().includes(qStr) ||
        u.firstName.toLowerCase().includes(qStr) ||
        u.lastName.toLowerCase().includes(qStr) ||
        u.id.toLowerCase().includes(qStr)
    );
  }
  if (email) {
    const emailStr = String(email).toLowerCase();
    users = users.filter((u) => u.email.toLowerCase().includes(emailStr));
  }
  if (firstName) {
    const fnStr = String(firstName).toLowerCase();
    users = users.filter((u) => u.firstName.toLowerCase().includes(fnStr));
  }
  if (lastName) {
    const lnStr = String(lastName).toLowerCase();
    users = users.filter((u) => u.lastName.toLowerCase().includes(lnStr));
  }
  if (role) {
    const roleStr = String(role);
    users = users.filter((u) => u.roles.includes(roleStr));
  }
  const activeBool = parseOptionalBoolean(isActive);
  if (activeBool !== undefined) {
    users = users.filter((u) => u.isActive === activeBool);
  }

  const userResponses = users.map(toAdminUserResponse);
  const params = parseCursorQuery(req.query as Record<string, unknown>);
  const result = cursorPaginate(userResponses, params);
  res.json(result);
});

// GET /api/v1/users/:id
router.get(
  '/:id',
  permissionGuard('read', 'User'),
  requireUuid('id'),
  (req, res) => {
    const id = req.params['id'] as string;
    const user = findUserById(id);
    if (!user) {
      res.status(404).json({
        message: 'User not found',
        statusCode: 404,
        errorKey: ErrorKeys.USERS.NOT_FOUND
      });
      return;
    }

    if (!assertInstancePermission(req, res, 'read', 'User', user)) {
      return;
    }

    res.json(toAdminUserResponse(user));
  }
);

// GET /api/v1/users/:id/permissions — admin read-only preview of a user's
// effective permissions: DB roles, resolved permissions and compiled CASL rules.
router.get(
  '/:id/permissions',
  permissionGuard('read', 'User'),
  requireUuid('id'),
  (req, res) => {
    const id = req.params['id'] as string;
    const user = findUserById(id);
    if (!user) {
      res.status(404).json({
        message: 'User not found',
        statusCode: 404,
        errorKey: ErrorKeys.USERS.NOT_FOUND
      });
      return;
    }

    if (!assertInstancePermission(req, res, 'read', 'User', user)) {
      return;
    }

    const adminResponse = toAdminUserResponse(user);
    const permissions = getResolvedPermissionsForUser(user);
    const rules = getPackedRulesForUser(user);
    res.json({
      roles: adminResponse.roles,
      permissions,
      rules
    });
  }
);

// PATCH /api/v1/users/:id
router.patch(
  '/:id',
  permissionGuard('update', 'User'),
  requireUuid('id'),
  (req, res) => {
    const id = req.params['id'] as string;

    // The server's global ValidationPipe runs before the handler, so a body that
    // fails UpdateUserDto is a 400 whether or not the addressed row exists. Only
    // checks that need the looked-up row stay below the 404.
    const { firstName, lastName, password, isActive, unlockAccount, locale } =
      req.body;
    // An explicit null is a 400 on the server, not an absent field: UpdateUserDto
    // uses PartialType(..., { skipNullProperties: false }).
    const email =
      req.body.email === undefined
        ? undefined
        : (normalizeEmail(req.body.email) ?? req.body.email);

    const bodyEmailErrors = emailErrors('email', req.body.email, 'definedOnly');
    if (bodyEmailErrors.length > 0) {
      res.status(400).json(validationError(bodyEmailErrors));
      return;
    }

    if (firstName !== undefined) {
      const fnMaxErr = validateMaxLength(firstName, 255, 'firstName');
      if (fnMaxErr) {
        res.status(400).json(validationError(fnMaxErr));
        return;
      }
    }

    if (lastName !== undefined) {
      const lnMaxErr = validateMaxLength(lastName, 255, 'lastName');
      if (lnMaxErr) {
        res.status(400).json(validationError(lnMaxErr));
        return;
      }
    }

    if (password !== undefined) {
      const pwLenErr = passwordLengthError(password);
      if (pwLenErr) {
        res.status(400).json(validationError(pwLenErr));
        return;
      }
    }

    const localeErr = validateLocale(locale);
    if (localeErr) {
      res.status(400).json(validationError(localeErr));
      return;
    }

    // The step-up factors of the caller, validated with the rest of the body
    // as UpdateUserDto does.
    const { currentPassword, code } = req.body;
    if (
      currentPassword !== undefined &&
      !isValidPasswordShape(currentPassword)
    ) {
      res.status(400).json(validationError('currentPassword is required'));
      return;
    }
    if (code !== undefined && !isValidCodeShape(code)) {
      res
        .status(400)
        .json(
          validationError(
            `code must be longer than or equal to ${TOTP_DIGITS} characters`
          )
        );
      return;
    }

    if (isActive !== undefined && typeof isActive !== 'boolean') {
      res.status(400).json(validationError('isActive must be a boolean value'));
      return;
    }

    if (unlockAccount !== undefined && typeof unlockAccount !== 'boolean') {
      res
        .status(400)
        .json(validationError('unlockAccount must be a boolean value'));
      return;
    }

    // Mirrors UsersController.update: a moderation field on the caller's own
    // record is refused before the lookup and the step-up.
    if (
      id === (req as AuthenticatedRequest).user.id &&
      (isActive !== undefined || unlockAccount !== undefined)
    ) {
      res.status(400).json({
        message:
          'You cannot deactivate or unlock your own account. Ask another administrator.',
        statusCode: 400,
        errorKey: ErrorKeys.USERS.MODERATION_SELF
      });
      return;
    }

    const user = findUserById(id);
    if (!user) {
      res.status(404).json({
        message: 'User not found',
        statusCode: 404,
        errorKey: ErrorKeys.USERS.NOT_FOUND
      });
      return;
    }

    if (!assertCanWriteUser(req, res, 'update', user)) {
      return;
    }

    // Mirrors UsersController.assertCredentialStepUp: the factor is the
    // CALLER's, whatever the target, and the provider proof never reaches
    // this route.
    if (
      password !== undefined ||
      (email !== undefined && email !== user.email)
    ) {
      const refusal = stepUpError(
        req,
        (req as AuthenticatedRequest).user,
        currentPassword,
        code,
        STEP_UP_OPERATION.USER_CREDENTIAL_CHANGE,
        false
      );
      if (refusal) {
        sendWithRetryAfter(res, refusal);
        return;
      }
    }

    // The blocklist verdict comes from UsersService.update on the real server,
    // after the ability check and before any field assignment, so a 400 must
    // leave the record unchanged.
    if (password !== undefined && isBreachedPassword(password)) {
      res.status(400).json(breachedPasswordEnvelope());
      return;
    }

    let previousEmail: string | undefined;
    if (email !== undefined) {
      const existing = findUserByEmail(email);
      const pendingConflict = Array.from(getState().users.values()).find(
        (u) => !u.deletedAt && u.pendingEmail === email && u.id !== user.id
      );
      if ((existing && existing.id !== user.id) || pendingConflict) {
        res.status(409).json({
          message: 'User with this email already exists',
          statusCode: 409,
          errorKey: ErrorKeys.USERS.EMAIL_EXISTS
        });
        return;
      }
      if (email !== user.email) {
        previousEmail = user.email;
        user.isEmailVerified = false;
        // Admin-set email overrides any self-service change in flight, and
        // voids a reset link mailed to the old address.
        clearMailedProofs(user);
        // The address is moved to recover an account; the previous holder must
        // not keep authenticating with the tokens issued before the move.
        revokeUserSessions(user);
      }
      user.email = email;
    }
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (locale !== undefined) user.locale = locale as string;
    if (password !== undefined) {
      user.password = password;
      // Invalidate target user's sessions so attacker cannot keep access after admin password reset
      revokeUserSessions(user);
      clearMailedProofs(user);
    }
    if (isActive !== undefined) {
      // Keyed on the submitted value and not on a transition, because the
      // server writes both effects whenever the request carries `false`.
      if (isActive === false) {
        revokeUserSessions(user);
        // Void every mailed link so none confirms against a disabled row or
        // revives on reactivation, the same reason the soft delete clears them.
        clearMailedProofs(user);
      }
      user.isActive = isActive;
    }
    if (unlockAccount) {
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
    }
    user.updatedAt = new Date().toISOString();

    const actor = (req as AuthenticatedRequest).user;
    // The step-up factors are stripped before the write, as on the server.
    const changedFields = Object.keys(req.body).filter(
      (k: string) => !['password', 'currentPassword', 'code'].includes(k)
    );
    logAudit('USER_UPDATE', {
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: id,
      targetType: 'User',
      details: { changedFields },
      ip: req.ip
    });

    // The USER_UPDATE row carries field names only, so without this row the
    // address the account moved to is unrecoverable. Mirrors the server.
    if (previousEmail !== undefined) {
      logAudit('USER_EMAIL_CHANGE_COMPLETE', {
        actorId: actor.id,
        actorEmail: actor.email,
        targetId: id,
        targetType: 'User',
        details: {
          oldEmail: previousEmail,
          newEmail: user.email,
          source: 'admin'
        },
        ip: req.ip
      });
    }

    if (password !== undefined) {
      logAudit('PASSWORD_CHANGE', {
        actorId: actor.id,
        actorEmail: actor.email,
        targetId: id,
        targetType: 'User',
        details: { source: 'admin' },
        ip: req.ip
      });

      console.log(
        `[PASSWORD CHANGED] To: ${user.email}\n  Source: administrator | IP: ${req.ip}`
      );
      pushToUser(id, { type: 'session_invalidated', userId: id });
    }

    pushUserCrudEvent('updated', id);
    res.json(toAdminUserResponse(user));
  }
);

// DELETE /api/v1/users/:id
router.delete(
  '/:id',
  permissionGuard('delete', 'User'),
  requireUuid('id'),
  (req, res) => {
    const id = req.params['id'] as string;
    const state = getState();
    const targetUser = findUserById(id);
    if (!targetUser) {
      res.status(404).json({
        message: 'User not found',
        statusCode: 404,
        errorKey: ErrorKeys.USERS.NOT_FOUND
      });
      return;
    }

    if (!assertCanWriteUser(req, res, 'delete', targetUser)) {
      return;
    }

    // Soft delete: set deletedAt timestamp
    targetUser.deletedAt = new Date().toISOString();
    targetUser.updatedAt = new Date().toISOString();

    // Void every mailed link so none confirms against a soft-deleted row or
    // revives on restore.
    clearMailedProofs(targetUser);

    // Revoke all refresh tokens for this user (active + revoked)
    for (const [token, userId] of state.refreshTokens.entries()) {
      if (userId === id) {
        state.refreshTokens.delete(token);
      }
    }
    for (const [token, userId] of state.revokedRefreshTokens.entries()) {
      if (userId === id) {
        state.revokedRefreshTokens.delete(token);
      }
    }

    // Stop any renewals/charges on the deleted user's subscriptions.
    cancelSubscriptionsForDeletedUser(id);

    const actor = (req as AuthenticatedRequest).user;
    logAudit('USER_DELETE', {
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: id,
      targetType: 'User',
      details: { targetEmail: targetUser.email },
      ip: req.ip
    });

    pushToUser(id, { type: 'session_invalidated', userId: id });
    pushUserCrudEvent('deleted', id);
    res.json({});
  }
);

// POST /api/v1/users/:id/restore
router.post(
  '/:id/restore',
  permissionGuard('delete', 'User'),
  requireUuid('id'),
  (req, res) => {
    const id = req.params['id'] as string;
    const targetUser = findUserByIdWithDeleted(id);
    if (!targetUser) {
      res.status(404).json({
        message: 'User not found',
        statusCode: 404,
        errorKey: ErrorKeys.USERS.NOT_FOUND
      });
      return;
    }

    // `UsersService.restore` gates on `delete`, not `update`.
    if (!assertCanWriteUser(req, res, 'delete', targetUser)) {
      return;
    }

    // Restore lifts the soft-delete only - `isActive` is a separate
    // administrative state changed through PATCH /users/:id.
    targetUser.deletedAt = null;
    targetUser.updatedAt = new Date().toISOString();

    const actor = (req as AuthenticatedRequest).user;
    logAudit('USER_RESTORE', {
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: id,
      targetType: 'User',
      details: { targetEmail: targetUser.email },
      ip: req.ip
    });

    pushUserCrudEvent('restored', id);
    res.json(toAdminUserResponse(targetUser));
  }
);

// POST /api/v1/users/:id/mfa/reset
// Mirrors UsersController.resetMfa, check for check and in the same order.
router.post(
  '/:id/mfa/reset',
  permissionGuard('update', 'User'),
  requireUuid('id'),
  (req, res) => {
    const id = req.params['id'] as string;
    const { currentPassword, code } = req.body;
    if (
      currentPassword !== undefined &&
      !isValidPasswordShape(currentPassword)
    ) {
      res.status(400).json(validationError('currentPassword is required'));
      return;
    }
    if (code !== undefined && !isValidCodeShape(code)) {
      res
        .status(400)
        .json(
          validationError(
            `code must be longer than or equal to ${TOTP_DIGITS} characters`
          )
        );
      return;
    }

    const actor = (req as AuthenticatedRequest).user;
    if (id === actor.id) {
      res.status(400).json({
        message:
          'Turn off your own two-factor authentication from your profile',
        statusCode: 400,
        errorKey: ErrorKeys.USERS.MFA_RESET_SELF
      });
      return;
    }

    const user = findUserById(id);
    if (!user) {
      res.status(404).json({
        message: 'User not found',
        statusCode: 404,
        errorKey: ErrorKeys.USERS.NOT_FOUND
      });
      return;
    }

    if (!assertCanWriteUser(req, res, 'update', user)) {
      return;
    }

    if (!user.totpEnabledAt) {
      res.status(400).json({
        message: 'Two-factor authentication is not enabled',
        statusCode: 400,
        errorKey: ErrorKeys.AUTH.MFA_NOT_ENABLED
      });
      return;
    }

    const refusal = stepUpError(
      req,
      actor,
      currentPassword,
      code,
      STEP_UP_OPERATION.USER_CREDENTIAL_CHANGE,
      false
    );
    if (refusal) {
      sendWithRetryAfter(res, refusal);
      return;
    }

    user.totpSecret = null;
    user.totpEnabledAt = null;
    user.totpRecoveryCodes = null;
    user.totpLastUsedStep = null;
    user.updatedAt = new Date().toISOString();
    revokeUserSessions(user);

    logAudit('MFA_RESET_BY_ADMIN', {
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: id,
      targetType: 'User',
      ip: req.ip
    });

    console.log(`[MFA RESET BY ADMIN] To: ${user.email} | IP: ${req.ip}`);

    pushUserCrudEvent('updated', id);
    res.json(toAdminUserResponse(user));
  }
);

export default router;
