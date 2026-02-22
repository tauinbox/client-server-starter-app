import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  PASSWORD_ERROR,
  PASSWORD_REGEX
} from '@app/shared/constants/password.constants';
import {
  ALLOWED_USER_SORT_COLUMNS,
  type UserSortColumn
} from '@app/shared/constants/user.constants';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER,
  MAX_PAGE_SIZE
} from '@app/shared/constants/pagination.constants';
import type { SortOrder } from '@app/shared/types/pagination.types';
import {
  findUserByEmail,
  findUserById,
  getState,
  toUserResponse
} from '../state';
import { adminGuard, authGuard } from '../helpers/auth.helpers';
import type { MockUser } from '../types';

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

const router = Router();

// POST /api/v1/users
router.post('/', adminGuard, (req, res) => {
  const { email, firstName, lastName, password } = req.body;

  if (!email || !firstName || !lastName || !password) {
    res
      .status(400)
      .json({ message: 'All fields are required', statusCode: 400 });
    return;
  }

  if (!PASSWORD_REGEX.test(password)) {
    res.status(400).json({ message: PASSWORD_ERROR, statusCode: 400 });
    return;
  }

  if (findUserByEmail(email)) {
    res.status(409).json({
      message: 'User with this email already exists',
      statusCode: 409
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
    createdAt: now,
    updatedAt: now
  };

  getState().users.set(user.id, user);

  res.status(201).json(toUserResponse(user));
});

// GET /api/v1/users
router.get('/', adminGuard, (req, res) => {
  const users = Array.from(getState().users.values()).map(toUserResponse);
  const params = parsePaginationParams(req.query as Record<string, unknown>);
  const result = paginateAndSort(users, params);
  res.json(result);
});

// GET /api/v1/users/search
router.get('/search', adminGuard, (req, res) => {
  const { email, firstName, lastName, isActive } = req.query;
  let users = Array.from(getState().users.values());

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

  const userResponses = users.map(toUserResponse);
  const params = parsePaginationParams(req.query as Record<string, unknown>);
  const result = paginateAndSort(userResponses, params);
  res.json(result);
});

// GET /api/v1/users/:id — requires auth (not admin) to match client route guards
router.get('/:id', authGuard, (req, res) => {
  const id = req.params['id'] as string;
  const user = findUserById(id);
  if (!user) {
    res.status(404).json({ message: 'User not found', statusCode: 404 });
    return;
  }

  res.json(toUserResponse(user));
});

// PATCH /api/v1/users/:id
router.patch('/:id', adminGuard, (req, res) => {
  const id = req.params['id'] as string;
  const user = findUserById(id);
  if (!user) {
    res.status(404).json({ message: 'User not found', statusCode: 404 });
    return;
  }

  const { email, firstName, lastName, password, isActive, unlockAccount } =
    req.body;

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
  }
  if (isActive !== undefined) user.isActive = isActive;
  if (unlockAccount) {
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
  }
  user.updatedAt = new Date().toISOString();

  res.json(toUserResponse(user));
});

// DELETE /api/v1/users/:id
router.delete('/:id', adminGuard, (req, res) => {
  const id = req.params['id'] as string;
  const state = getState();
  if (!state.users.has(id)) {
    res.status(404).json({ message: 'User not found', statusCode: 404 });
    return;
  }

  state.users.delete(id);
  state.oauthAccounts.delete(id);

  res.json({});
});

export default router;
