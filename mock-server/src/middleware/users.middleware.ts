import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  ALLOWED_USER_SORT_COLUMNS,
  ErrorKeys,
  MAX_USER_FILTER_LENGTH,
  PASSWORD_ERROR,
  PASSWORD_REGEX
} from '@app/shared/constants';
import { normalizeEmail } from '@app/shared/utils/email';
import {
  isValidEmail,
  validateLocale,
  validateMaxLength,
  validateMinLength
} from '../utils/validation';
import type { PaginationQuery } from '../helpers/pagination.helpers';
import {
  compareValues,
  cursorPaginate,
  cursorQueryErrors,
  paginationQueryErrors,
  parseCursorQuery,
  parsePaginationQuery
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
import { adminGuard, authGuard } from '../helpers/auth.helpers';
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
function userQueryErrors(
  query: Record<string, unknown>,
  mode: 'offset' | 'cursor'
): string[] {
  const filterError = findFilterValidationError(query);
  const options = {
    extraAllowed: USER_QUERY_KEYS,
    sortColumns: ALLOWED_USER_SORT_COLUMNS
  };
  const pagingErrors =
    mode === 'cursor'
      ? cursorQueryErrors(query, options)
      : paginationQueryErrors(query, options);
  return filterError ? [filterError, ...pagingErrors] : pagingErrors;
}

function paginateAndSort<T extends Record<string, unknown>>(
  items: T[],
  params: PaginationQuery
): {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
} {
  const { page, limit, sortBy, sortOrder } = params;

  const sorted = [...items].sort((a, b) => {
    const aVal: unknown = a[sortBy];
    const bVal: unknown = b[sortBy];

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;

    const cmp = compareValues(aVal, bVal);
    return sortOrder === 'asc' ? cmp : -cmp;
  });

  const total = sorted.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const data = sorted.slice(start, start + limit);

  return { data, meta: { page, limit, total, totalPages } };
}

const router = Router();

// POST /api/v1/users
router.post('/', adminGuard, (req, res) => {
  const { firstName, lastName, password } = req.body;
  const email = normalizeEmail(req.body.email) ?? '';

  if (!email || !firstName || !lastName || !password) {
    res.status(400).json(validationError('All fields are required'));
    return;
  }

  if (!isValidEmail(email)) {
    res.status(400).json(validationError('email must be an email'));
    return;
  }

  const emailMaxErr = validateMaxLength(email, 255, 'email');
  const fnMaxErr = validateMaxLength(firstName, 255, 'firstName');
  const lnMaxErr = validateMaxLength(lastName, 255, 'lastName');
  const pwMinErr = validateMinLength(password, 8, 'password');
  const pwMaxErr = validateMaxLength(password, 128, 'password');
  const lengthErr = emailMaxErr || fnMaxErr || lnMaxErr || pwMinErr || pwMaxErr;
  if (lengthErr) {
    res.status(400).json(validationError(lengthErr));
    return;
  }

  if (!PASSWORD_REGEX.test(password)) {
    res.status(400).json(validationError(PASSWORD_ERROR));
    return;
  }

  const locale: unknown = req.body.locale;
  const localeErr = validateLocale(locale);
  if (localeErr) {
    res.status(400).json(validationError(localeErr));
    return;
  }

  if (
    findUserByEmail(email) ||
    Array.from(getState().users.values()).some(
      (u) => !u.deletedAt && u.pendingEmail === email
    )
  ) {
    res.status(409).json({
      message: 'User with this email already exists',
      statusCode: 409,
      errorKey: ErrorKeys.USERS.EMAIL_EXISTS
    });
    return;
  }

  const now = new Date().toISOString();
  const user: MockUser = {
    id: uuidv4(),
    email,
    firstName,
    lastName,
    password,
    isActive: true,
    roles: ['user'],
    isEmailVerified: true,
    locale: (locale as string) ?? 'en',
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

// GET /api/v1/users
router.get('/', adminGuard, (req, res) => {
  const queryErrors = userQueryErrors(
    req.query as Record<string, unknown>,
    'offset'
  );
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
  const params = parsePaginationQuery(req.query as Record<string, unknown>);
  const result = paginateAndSort(users, params);
  res.json(result);
});

// GET /api/v1/users/search
router.get('/search', adminGuard, (req, res) => {
  const queryErrors = userQueryErrors(
    req.query as Record<string, unknown>,
    'offset'
  );
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
  const params = parsePaginationQuery(req.query as Record<string, unknown>);
  const result = paginateAndSort(userResponses, params);
  res.json(result);
});

// GET /api/v1/users/cursor
router.get('/cursor', adminGuard, (req, res) => {
  const queryErrors = userQueryErrors(
    req.query as Record<string, unknown>,
    'cursor'
  );
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
router.get('/search/cursor', adminGuard, (req, res) => {
  const queryErrors = userQueryErrors(
    req.query as Record<string, unknown>,
    'cursor'
  );
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

// GET /api/v1/users/:id — requires auth (not admin) to match client route guards
router.get('/:id', authGuard, requireUuid('id'), (req, res) => {
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

  res.json(toAdminUserResponse(user));
});

// GET /api/v1/users/:id/permissions — admin read-only preview of a user's
// effective permissions: DB roles, resolved permissions and compiled CASL rules.
router.get('/:id/permissions', adminGuard, requireUuid('id'), (req, res) => {
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

  const adminResponse = toAdminUserResponse(user);
  const permissions = getResolvedPermissionsForUser(user);
  const rules = getPackedRulesForUser(user);
  res.json({
    roles: adminResponse.roles,
    permissions,
    rules
  });
});

// PATCH /api/v1/users/:id
router.patch('/:id', adminGuard, requireUuid('id'), (req, res) => {
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

  if (email !== undefined) {
    if (!isValidEmail(email)) {
      res.status(400).json(validationError('email must be an email'));
      return;
    }
    const emailMaxErr = validateMaxLength(email, 255, 'email');
    if (emailMaxErr) {
      res.status(400).json(validationError(emailMaxErr));
      return;
    }
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
    const pwLenErr =
      validateMinLength(password, 8, 'password') ??
      validateMaxLength(password, 128, 'password');
    if (pwLenErr) {
      res.status(400).json(validationError(pwLenErr));
      return;
    }
    // Regex must be checked with the rest of the DTO validation, before any
    // field assignment: the real server validates the whole DTO first and
    // never partially mutates on a 400.
    if (!PASSWORD_REGEX.test(password)) {
      res.status(400).json(validationError(PASSWORD_ERROR));
      return;
    }
  }

  const localeErr = validateLocale(locale);
  if (localeErr) {
    res.status(400).json(validationError(localeErr));
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

  const user = findUserById(id);
  if (!user) {
    res.status(404).json({
      message: 'User not found',
      statusCode: 404,
      errorKey: ErrorKeys.USERS.NOT_FOUND
    });
    return;
  }

  if (email !== undefined) {
    const existing = findUserByEmail(email);
    const pendingConflict = Array.from(getState().users.values()).find(
      (u) => !u.deletedAt && u.pendingEmail === email && u.id !== user.id
    );
    if ((existing && existing.id !== user.id) || pendingConflict) {
      res.status(409).json({
        message: 'User with this email already exists',
        statusCode: 409,
        errorKey: ErrorKeys.USERS.EMAIL_EXISTS,
        field: 'email'
      });
      return;
    }
    if (email !== user.email) {
      user.isEmailVerified = false;
      // Admin-set email overrides any self-service change in flight.
      if (user.pendingEmailToken) {
        getState().pendingEmailTokens.delete(user.pendingEmailToken);
      }
      user.pendingEmail = null;
      user.pendingEmailToken = null;
      user.pendingEmailExpiresAt = null;
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
  }
  if (isActive !== undefined) {
    if (isActive === false && user.isActive !== false) {
      user.tokenRevokedAt = new Date().toISOString();
    }
    user.isActive = isActive;
  }
  if (unlockAccount) {
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
  }
  user.updatedAt = new Date().toISOString();

  const actor = (req as AuthenticatedRequest).user;
  const changedFields = Object.keys(req.body).filter(
    (k: string) => k !== 'password'
  );
  logAudit('USER_UPDATE', {
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: id,
    targetType: 'User',
    details: { changedFields },
    ip: req.ip
  });

  if (password !== undefined) {
    logAudit('PASSWORD_CHANGE', {
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: id,
      targetType: 'User',
      details: { source: 'admin' },
      ip: req.ip
    });
    pushToUser(id, { type: 'session_invalidated', userId: id });
  }

  pushUserCrudEvent('updated', id);
  res.json(toAdminUserResponse(user));
});

// DELETE /api/v1/users/:id
router.delete('/:id', adminGuard, requireUuid('id'), (req, res) => {
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

  // Soft delete: set deletedAt timestamp
  targetUser.deletedAt = new Date().toISOString();
  targetUser.updatedAt = new Date().toISOString();

  // Clear any in-flight self-service email change so a stale token cannot
  // confirm against a soft-deleted row.
  if (targetUser.pendingEmailToken) {
    state.pendingEmailTokens.delete(targetUser.pendingEmailToken);
  }
  targetUser.pendingEmail = null;
  targetUser.pendingEmailToken = null;
  targetUser.pendingEmailExpiresAt = null;

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
});

// POST /api/v1/users/:id/restore
router.post('/:id/restore', adminGuard, requireUuid('id'), (req, res) => {
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
});

export default router;
