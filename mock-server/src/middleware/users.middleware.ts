import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  PASSWORD_ERROR,
  PASSWORD_REGEX
} from '@app/shared/constants/password.constants';
import { ErrorKeys } from '@app/shared/constants/error-keys';
import {
  isValidEmail,
  validateMaxLength,
  validateMinLength
} from '../utils/validation';
import {
  ALLOWED_USER_SORT_COLUMNS,
  type UserSortColumn
} from '@app/shared/constants/user.constants';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_CURSOR_PAGE_SIZE,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER,
  MAX_PAGE_SIZE
} from '@app/shared/constants/pagination.constants';
import type { SortOrder } from '@app/shared/types/pagination.types';
import { decodeCursor, encodeCursor } from '../utils/cursor';
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
import type { AuthenticatedRequest, MockUser } from '../types';
import { pushToAll, pushToUser } from '../sse-hub';

interface PaginationParams {
  page: number;
  limit: number;
  sortBy: UserSortColumn;
  sortOrder: SortOrder;
}

function parsePaginationParams(
  query: Record<string, unknown>
): PaginationParams {
  let page = Number(query['page']) || DEFAULT_PAGE;
  if (page < 1) page = 1;

  let limit = Number(query['limit']) || DEFAULT_PAGE_SIZE;
  if (limit < 1) limit = 1;
  if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;

  const sortByRaw = String(query['sortBy'] || DEFAULT_SORT_BY);
  const sortBy = (ALLOWED_USER_SORT_COLUMNS as readonly string[]).includes(
    sortByRaw
  )
    ? (sortByRaw as UserSortColumn)
    : (DEFAULT_SORT_BY as UserSortColumn);

  const sortOrderRaw = String(
    query['sortOrder'] || DEFAULT_SORT_ORDER
  ).toLowerCase();
  const sortOrder: SortOrder = sortOrderRaw === 'asc' ? 'asc' : 'desc';

  return { page, limit, sortBy, sortOrder };
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b);
  }
  return String(a).localeCompare(String(b));
}

function paginateAndSort<T extends Record<string, unknown>>(
  items: T[],
  params: PaginationParams
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

interface CursorPaginationParams {
  cursor?: string;
  limit: number;
  sortBy: UserSortColumn;
  sortOrder: SortOrder;
}

function parseCursorPaginationParams(
  query: Record<string, unknown>
): CursorPaginationParams {
  const cursor = query['cursor'] ? String(query['cursor']) : undefined;

  let limit = Number(query['limit']) || DEFAULT_CURSOR_PAGE_SIZE;
  if (limit < 1) limit = 1;
  if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;

  const sortByRaw = String(query['sortBy'] || DEFAULT_SORT_BY);
  const sortBy = (ALLOWED_USER_SORT_COLUMNS as readonly string[]).includes(
    sortByRaw
  )
    ? (sortByRaw as UserSortColumn)
    : (DEFAULT_SORT_BY as UserSortColumn);

  const sortOrderRaw = String(
    query['sortOrder'] || DEFAULT_SORT_ORDER
  ).toLowerCase();
  const sortOrder: SortOrder = sortOrderRaw === 'asc' ? 'asc' : 'desc';

  return { cursor, limit, sortBy, sortOrder };
}

function cursorPaginateAndSort<T extends Record<string, unknown>>(
  items: T[],
  params: CursorPaginationParams
): {
  data: T[];
  meta: { nextCursor: string | null; hasMore: boolean; limit: number };
} {
  const { cursor, limit, sortBy, sortOrder } = params;

  const sorted = [...items].sort((a, b) => {
    const aVal: unknown = a[sortBy];
    const bVal: unknown = b[sortBy];

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;

    const cmp = compareValues(aVal, bVal);
    const result = sortOrder === 'asc' ? cmp : -cmp;
    if (result !== 0) return result;

    const aId = String(a['id'] ?? '');
    const bId = String(b['id'] ?? '');
    const idCmp = aId.localeCompare(bId);
    return sortOrder === 'asc' ? idCmp : -idCmp;
  });

  let startIndex = 0;

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      const cursorSortValue = decoded.sortValue;
      const cursorId = decoded.id;

      startIndex = sorted.findIndex((item) => {
        const itemSortVal = item[sortBy];
        const itemId = String(item['id'] ?? '');

        if (sortOrder === 'desc') {
          const cmp = compareValues(itemSortVal, cursorSortValue);
          if (cmp < 0) return true;
          if (cmp === 0 && itemId.localeCompare(cursorId) < 0) return true;
          return false;
        } else {
          const cmp = compareValues(itemSortVal, cursorSortValue);
          if (cmp > 0) return true;
          if (cmp === 0 && itemId.localeCompare(cursorId) > 0) return true;
          return false;
        }
      });
      if (startIndex === -1) startIndex = sorted.length;
    }
  }

  const slice = sorted.slice(startIndex, startIndex + limit + 1);
  const hasMore = slice.length > limit;
  const data = hasMore ? slice.slice(0, limit) : slice;

  const lastItem = data[data.length - 1];
  const nextCursor =
    hasMore && lastItem
      ? encodeCursor({
          sortValue: (lastItem[sortBy] as string | number | boolean) ?? null,
          id: String(lastItem['id'] ?? '')
        })
      : null;

  return { data, meta: { nextCursor, hasMore, limit } };
}

const router = Router();

// POST /api/v1/users
router.post('/', adminGuard, (req, res) => {
  const { firstName, lastName, password } = req.body;
  const email = req.body.email?.trim().toLowerCase();

  if (!email || !firstName || !lastName || !password) {
    res
      .status(400)
      .json({ message: 'All fields are required', statusCode: 400 });
    return;
  }

  if (!isValidEmail(email)) {
    res
      .status(400)
      .json({ message: 'email must be an email', statusCode: 400 });
    return;
  }

  const emailMaxErr = validateMaxLength(email, 255, 'email');
  const fnMaxErr = validateMaxLength(firstName, 255, 'firstName');
  const lnMaxErr = validateMaxLength(lastName, 255, 'lastName');
  const pwMinErr = validateMinLength(password, 8, 'password');
  const pwMaxErr = validateMaxLength(password, 128, 'password');
  const lengthErr = emailMaxErr || fnMaxErr || lnMaxErr || pwMinErr || pwMaxErr;
  if (lengthErr) {
    res.status(400).json({ message: lengthErr, statusCode: 400 });
    return;
  }

  if (!PASSWORD_REGEX.test(password)) {
    res.status(400).json({ message: PASSWORD_ERROR, statusCode: 400 });
    return;
  }

  if (findUserByEmail(email)) {
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
    failedLoginAttempts: 0,
    lockedUntil: null,
    tokenRevokedAt: null,
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

  pushToAll({ type: 'user_crud_events', action: 'created', userId: user.id });
  res.status(201).json(toAdminUserResponse(user));
});

// GET /api/v1/users
router.get('/', adminGuard, (req, res) => {
  const includeDeleted = String(req.query['includeDeleted']) === 'true';
  let allUsers = Array.from(getState().users.values());
  if (!includeDeleted) {
    allUsers = allUsers.filter((u) => !u.deletedAt);
  }
  const users = allUsers.map(toAdminUserResponse);
  const params = parsePaginationParams(req.query as Record<string, unknown>);
  const result = paginateAndSort(users, params);
  res.json(result);
});

// GET /api/v1/users/search
router.get('/search', adminGuard, (req, res) => {
  const { email, firstName, lastName, isActive } = req.query;
  const includeDeleted = String(req.query['includeDeleted']) === 'true';
  let users = Array.from(getState().users.values());

  if (!includeDeleted) {
    users = users.filter((u) => !u.deletedAt);
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
  if (isActive !== undefined) {
    const activeBool = String(isActive) === 'true';
    users = users.filter((u) => u.isActive === activeBool);
  }

  const userResponses = users.map(toAdminUserResponse);
  const params = parsePaginationParams(req.query as Record<string, unknown>);
  const result = paginateAndSort(userResponses, params);
  res.json(result);
});

// GET /api/v1/users/cursor
router.get('/cursor', adminGuard, (req, res) => {
  const includeDeleted = String(req.query['includeDeleted']) === 'true';
  let allUsers = Array.from(getState().users.values());
  if (!includeDeleted) {
    allUsers = allUsers.filter((u) => !u.deletedAt);
  }
  const users = allUsers.map(toAdminUserResponse);
  const params = parseCursorPaginationParams(
    req.query as Record<string, unknown>
  );
  const result = cursorPaginateAndSort(users, params);
  res.json(result);
});

// GET /api/v1/users/search/cursor
router.get('/search/cursor', adminGuard, (req, res) => {
  const { email, firstName, lastName, isActive } = req.query;
  const includeDeleted = String(req.query['includeDeleted']) === 'true';
  let users = Array.from(getState().users.values());

  if (!includeDeleted) {
    users = users.filter((u) => !u.deletedAt);
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
  if (isActive !== undefined) {
    const activeBool = String(isActive) === 'true';
    users = users.filter((u) => u.isActive === activeBool);
  }

  const userResponses = users.map(toAdminUserResponse);
  const params = parseCursorPaginationParams(
    req.query as Record<string, unknown>
  );
  const result = cursorPaginateAndSort(userResponses, params);
  res.json(result);
});

// GET /api/v1/users/:id — requires auth (not admin) to match client route guards
router.get('/:id', authGuard, (req, res) => {
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
router.get('/:id/permissions', adminGuard, (req, res) => {
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
router.patch('/:id', adminGuard, (req, res) => {
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

  const { firstName, lastName, password, isActive, unlockAccount } = req.body;
  const email = req.body.email?.trim().toLowerCase();

  if (email !== undefined) {
    if (!isValidEmail(email)) {
      res
        .status(400)
        .json({ message: 'email must be an email', statusCode: 400 });
      return;
    }
    const emailMaxErr = validateMaxLength(email, 255, 'email');
    if (emailMaxErr) {
      res.status(400).json({ message: emailMaxErr, statusCode: 400 });
      return;
    }
  }

  if (firstName !== undefined) {
    const fnMaxErr = validateMaxLength(firstName, 255, 'firstName');
    if (fnMaxErr) {
      res.status(400).json({ message: fnMaxErr, statusCode: 400 });
      return;
    }
  }

  if (lastName !== undefined) {
    const lnMaxErr = validateMaxLength(lastName, 255, 'lastName');
    if (lnMaxErr) {
      res.status(400).json({ message: lnMaxErr, statusCode: 400 });
      return;
    }
  }

  if (password !== undefined) {
    const pwMinErr = validateMinLength(password, 8, 'password');
    const pwMaxErr = validateMaxLength(password, 128, 'password');
    if (pwMinErr || pwMaxErr) {
      res.status(400).json({ message: pwMinErr || pwMaxErr, statusCode: 400 });
      return;
    }
  }

  if (email !== undefined) {
    const existing = findUserByEmail(email);
    if (existing && existing.id !== user.id) {
      res.status(409).json({
        message: 'User with this email already exists',
        statusCode: 409
      });
      return;
    }
    user.email = email;
  }
  if (firstName !== undefined) user.firstName = firstName;
  if (lastName !== undefined) user.lastName = lastName;
  if (password !== undefined) {
    if (!PASSWORD_REGEX.test(password)) {
      res.status(400).json({ message: PASSWORD_ERROR, statusCode: 400 });
      return;
    }
    user.password = password;
    // Invalidate target user's sessions so attacker cannot keep access after admin password reset
    user.tokenRevokedAt = new Date().toISOString();
    const sessionState = getState();
    for (const [token, uid] of sessionState.refreshTokens.entries()) {
      if (uid === user.id) {
        sessionState.refreshTokens.delete(token);
      }
    }
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

  pushToAll({ type: 'user_crud_events', action: 'updated', userId: id });
  res.json(toAdminUserResponse(user));
});

// DELETE /api/v1/users/:id
router.delete('/:id', adminGuard, (req, res) => {
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

  // Revoke all refresh tokens for this user
  for (const [token, userId] of state.refreshTokens.entries()) {
    if (userId === id) {
      state.refreshTokens.delete(token);
    }
  }

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
  pushToAll({ type: 'user_crud_events', action: 'deleted', userId: id });
  res.json({});
});

// POST /api/v1/users/:id/restore
router.post('/:id/restore', adminGuard, (req, res) => {
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

  targetUser.deletedAt = null;
  targetUser.isActive = true;
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

  pushToAll({ type: 'user_crud_events', action: 'restored', userId: id });
  res.json(toAdminUserResponse(targetUser));
});

export default router;
