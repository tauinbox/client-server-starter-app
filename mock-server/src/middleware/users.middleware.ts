import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  ErrorKeys,
  STEP_UP_OPERATION,
  SUPPORTED_LOCALES,
  USER_LIST_QUERY
} from '@app/shared/constants';
import { normalizeEmail } from '@app/shared/utils/email';
import { changedFields, withChanges } from '@app/shared/utils/changed-fields';
import { newPasswordRefusal } from '../helpers/breached-password.helpers';
import {
  booleanErrors,
  emailErrors,
  nameErrors,
  newPasswordErrors,
  oneOfErrors,
  trimName
} from '../utils/validation';
import {
  listPage,
  listQueryErrors,
  parseListQuery,
  rejectInvalidCursor
} from '../helpers/list-query.helpers';
import {
  findUserByEmail,
  findUserById,
  findUserByIdWithDeleted,
  getPackedRulesForUser,
  getResolvedPermissionsForUser,
  getState,
  logAudit,
  revokeUserSessions,
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
  sendWithRetryAfter,
  stepUpError,
  stepUpFactorsBodyErrors
} from '../helpers/reauth.helpers';
import { cancelSubscriptionsForDeletedUser } from './billing.middleware';
import { filterByAbility } from '../helpers/ability-filter.helpers';
import type { AuthenticatedRequest } from '../types';
import { pushUserCrudEvent } from '../helpers/user-list-events.helpers';
import {
  requireUuid,
  sendValidationError
} from '../helpers/validation-error.helpers';
import { sendError } from '../helpers/error-envelope.helpers';

/**
 * Both list routes share one DTO and one query on the server, so both apply
 * every filter and both `params`: `role` (a join on the server) and
 * `includeDeleted` (a scope switch), applied here before the list query.
 */
function listUsers(req: Request, res: Response): void {
  const query = req.query as Record<string, unknown>;
  const queryErrors = listQueryErrors(query, USER_LIST_QUERY);
  if (queryErrors.length > 0) {
    sendValidationError(res, 'query', queryErrors);
    return;
  }
  if (rejectInvalidCursor(res, query)) return;
  const { role, includeDeleted } = parseListQuery(query, USER_LIST_QUERY);
  const users = Array.from(getState().users.values()).filter(
    (u) => (includeDeleted || !u.deletedAt) && (!role || u.roles.includes(role))
  );
  const page = listPage(
    filterByAbility(
      users,
      (req as AuthenticatedRequest).user,
      'search',
      'User'
    ),
    USER_LIST_QUERY,
    query
  );
  res.json({ data: page.data.map(toAdminUserResponse), meta: page.meta });
}

const router = Router();

/** The own fields of `UpdateUserDto`, beside the step-up factors. */
const UPDATE_USER_FIELDS = [
  'email',
  'name',
  'password',
  'locale',
  'isActive',
  'unlockAccount'
] as const;

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
router.get('/cursor', permissionGuard('search', 'User'), listUsers);

// GET /api/v1/users/search/cursor
router.get('/search/cursor', permissionGuard('search', 'User'), listUsers);

// GET /api/v1/users/:id
router.get(
  '/:id',
  permissionGuard('read', 'User'),
  requireUuid('id'),
  (req, res) => {
    const id = req.params['id'] as string;
    const user = findUserById(id);
    if (!user) {
      sendError(res, ErrorKeys.USERS.NOT_FOUND, `User with ID ${id} not found`);
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
      sendError(res, ErrorKeys.USERS.NOT_FOUND, `User with ID ${id} not found`);
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

    // The server's global ValidationPipe runs before the handler, so a body
    // that fails UpdateUserDto is a validation error whether or not the
    // addressed row exists. Only checks that need the looked-up row stay below
    // `NOT_FOUND`.
    const { password, isActive, unlockAccount, locale, currentPassword, code } =
      req.body;
    const name = trimName(req.body['name']);

    // UpdateUserDto declares its own fields ahead of the inherited
    // CreateUserDto fields, so the server reports them first.
    const bodyErrors = stepUpFactorsBodyErrors(req.body, UPDATE_USER_FIELDS, [
      ...booleanErrors('isActive', isActive, 'definedOnly'),
      ...booleanErrors('unlockAccount', unlockAccount, 'definedOnly'),
      ...emailErrors('email', req.body.email, 'definedOnly'),
      ...nameErrors(name, 'definedOnly'),
      ...newPasswordErrors(password, 'definedOnly'),
      ...oneOfErrors('locale', locale, SUPPORTED_LOCALES, 'definedOnly')
    ]);
    if (bodyErrors.length > 0) {
      sendValidationError(res, 'body', bodyErrors);
      return;
    }

    // An explicit null fails the DTO on the server, not an absent field:
    // UpdateUserDto uses PartialType(..., { skipNullProperties: false }).
    const email =
      req.body.email === undefined
        ? undefined
        : (normalizeEmail(req.body.email) ?? req.body.email);

    // Mirrors UsersController.update: a moderation field on the caller's own
    // record is refused before the lookup and the step-up.
    if (
      id === (req as AuthenticatedRequest).user.id &&
      (isActive !== undefined || unlockAccount !== undefined)
    ) {
      sendError(
        res,
        ErrorKeys.USERS.MODERATION_SELF,
        'You cannot deactivate or unlock your own account. Ask another administrator.'
      );
      return;
    }

    const user = findUserById(id);
    if (!user) {
      sendError(res, ErrorKeys.USERS.NOT_FOUND, `User with ID ${id} not found`);
      return;
    }

    // Mirrors UsersController.update: the credentials of the caller's own
    // record change only through the profile flows. After the lookup, since
    // a resubmitted address is compared with the stored one.
    if (
      id === (req as AuthenticatedRequest).user.id &&
      (password !== undefined || (email !== undefined && email !== user.email))
    ) {
      sendError(
        res,
        ErrorKeys.USERS.CREDENTIAL_SELF,
        'Change your own email and password on your profile page'
      );
      return;
    }

    // The record after the write is checked too, as in UsersService.update.
    if (
      !assertCanWriteUser(req, res, 'update', user) ||
      !assertCanWriteUser(
        req,
        res,
        'update',
        withChanges(user, { email, name, locale, isActive })
      )
    ) {
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
    // after the ability check and before any field assignment, so a refused
    // password must leave the record unchanged.
    const passwordRefusal =
      password === undefined
        ? null
        : newPasswordRefusal(password, {
            email: email ?? user.email,
            name: typeof name === 'string' ? name : user.name
          });
    if (passwordRefusal) {
      sendError(res, passwordRefusal.errorKey, passwordRefusal.message);
      return;
    }

    const changed = changedFields(user, {
      email,
      name,
      locale,
      isActive
    });
    if (
      unlockAccount &&
      (user.failedLoginAttempts !== 0 || user.lockedUntil !== null)
    ) {
      changed.push('unlockAccount');
    }
    const previous = { ...user };

    let previousEmail: string | undefined;
    if (email !== undefined) {
      const existing = findUserByEmail(email);
      const pendingConflict = Array.from(getState().users.values()).find(
        (u) => !u.deletedAt && u.pendingEmail === email && u.id !== user.id
      );
      if ((existing && existing.id !== user.id) || pendingConflict) {
        sendError(
          res,
          ErrorKeys.USERS.EMAIL_EXISTS,
          'User with this email already exists'
        );
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
        revokeUserSessions(user.id);
      }
      user.email = email;
    }
    if (typeof name === 'string') user.name = name;
    if (locale !== undefined) user.locale = locale as string;
    if (password !== undefined) {
      user.password = password;
      // Invalidate target user's sessions so attacker cannot keep access after admin password reset
      revokeUserSessions(user.id);
      clearMailedProofs(user);
    }
    if (isActive !== undefined) {
      // Keyed on the submitted value and not on a transition, because the
      // server writes both effects whenever the request carries `false`.
      if (isActive === false) {
        revokeUserSessions(user.id);
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
    logAudit('USER_UPDATE', {
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: id,
      targetType: 'User',
      details: { changedFields: changed },
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
      console.log(
        `[EMAIL CHANGE COMPLETE] To: ${previousEmail}\n  Source: administrator`
      );
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
    }

    pushUserCrudEvent('updated', id, previous);
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
    const targetUser = findUserById(id);
    if (!targetUser) {
      sendError(res, ErrorKeys.USERS.NOT_FOUND, `User with ID ${id} not found`);
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

    // End every session, as the server's revocation listener does on delete.
    revokeUserSessions(targetUser.id);

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
      sendError(res, ErrorKeys.USERS.NOT_FOUND, `User with ID ${id} not found`);
      return;
    }

    // `UsersService.restore` gates on `delete`, not `update`.
    if (!assertCanWriteUser(req, res, 'delete', targetUser)) {
      return;
    }

    if (!targetUser.deletedAt) {
      sendError(
        res,
        ErrorKeys.USERS.NOT_DELETED,
        `User with ID ${id} is not deleted, so there is nothing to restore`
      );
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
    const bodyErrors = stepUpFactorsBodyErrors(req.body);
    if (bodyErrors.length > 0) {
      sendValidationError(res, 'body', bodyErrors);
      return;
    }

    const actor = (req as AuthenticatedRequest).user;
    if (id === actor.id) {
      sendError(
        res,
        ErrorKeys.USERS.MFA_RESET_SELF,
        'Turn off your own two-factor authentication from your profile'
      );
      return;
    }

    const user = findUserById(id);
    if (!user) {
      sendError(res, ErrorKeys.USERS.NOT_FOUND, `User with ID ${id} not found`);
      return;
    }

    if (!assertCanWriteUser(req, res, 'update', user)) {
      return;
    }

    if (!user.totpEnabledAt) {
      sendError(
        res,
        ErrorKeys.AUTH.MFA_NOT_ENABLED,
        'Two-factor authentication is not enabled'
      );
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
    revokeUserSessions(user.id);

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

// POST /api/v1/users/:id/sessions/revoke
// Mirrors UsersController.revokeSessions, check for check and in the same order.
router.post(
  '/:id/sessions/revoke',
  permissionGuard('update', 'User'),
  requireUuid('id'),
  (req, res) => {
    const id = req.params['id'] as string;
    const actor = (req as AuthenticatedRequest).user;
    if (id === actor.id) {
      sendError(
        res,
        ErrorKeys.USERS.SESSION_REVOKE_SELF,
        'End your own sessions from your profile'
      );
      return;
    }

    const user = findUserById(id);
    if (!user) {
      sendError(res, ErrorKeys.USERS.NOT_FOUND, `User with ID ${id} not found`);
      return;
    }

    if (!assertCanWriteUser(req, res, 'update', user)) {
      return;
    }

    revokeUserSessions(user.id);

    logAudit('SESSION_REVOKE', {
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: id,
      targetType: 'User',
      details: { scope: 'all', source: 'admin' },
      ip: req.ip
    });

    res.json({ message: 'Every session of the user has ended' });
  }
);

export default router;
