import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  findUserByEmail,
  findUserById,
  getState,
  toUserResponse
} from '../state';
import { requireAdmin } from '../helpers/auth.helpers';
import type { MockUser } from '../types';

const router = Router();

// POST /api/v1/users
router.post('/', (req, res) => {
  const admin = requireAdmin(req);
  if ('error' in admin) {
    const msg = admin.error === 403 ? 'Forbidden' : 'Unauthorized';
    res.status(admin.error).json({ message: msg, statusCode: admin.error });
    return;
  }

  const { email, firstName, lastName, password } = req.body;

  if (!email || !firstName || !lastName || !password) {
    res
      .status(400)
      .json({ message: 'All fields are required', statusCode: 400 });
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
    isAdmin: false,
    createdAt: now,
    updatedAt: now
  };

  getState().users.set(user.id, user);

  res.status(201).json(toUserResponse(user));
});

// GET /api/v1/users
router.get('/', (req, res) => {
  const admin = requireAdmin(req);
  if ('error' in admin) {
    const msg = admin.error === 403 ? 'Forbidden' : 'Unauthorized';
    res.status(admin.error).json({ message: msg, statusCode: admin.error });
    return;
  }

  const users = Array.from(getState().users.values()).map(toUserResponse);
  res.json(users);
});

// GET /api/v1/users/search
router.get('/search', (req, res) => {
  const admin = requireAdmin(req);
  if ('error' in admin) {
    const msg = admin.error === 403 ? 'Forbidden' : 'Unauthorized';
    res.status(admin.error).json({ message: msg, statusCode: admin.error });
    return;
  }

  const { email, firstName, lastName, isAdmin, isActive } = req.query;
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
  if (isAdmin !== undefined) {
    const adminBool = String(isAdmin) === 'true';
    users = users.filter((u) => u.isAdmin === adminBool);
  }
  if (isActive !== undefined) {
    const activeBool = String(isActive) === 'true';
    users = users.filter((u) => u.isActive === activeBool);
  }

  res.json(users.map(toUserResponse));
});

// GET /api/v1/users/:id
router.get('/:id', (req, res) => {
  const admin = requireAdmin(req);
  if ('error' in admin) {
    const msg = admin.error === 403 ? 'Forbidden' : 'Unauthorized';
    res.status(admin.error).json({ message: msg, statusCode: admin.error });
    return;
  }

  const user = findUserById(req.params.id);
  if (!user) {
    res.status(404).json({ message: 'User not found', statusCode: 404 });
    return;
  }

  res.json(toUserResponse(user));
});

// PATCH /api/v1/users/:id
router.patch('/:id', (req, res) => {
  const admin = requireAdmin(req);
  if ('error' in admin) {
    const msg = admin.error === 403 ? 'Forbidden' : 'Unauthorized';
    res.status(admin.error).json({ message: msg, statusCode: admin.error });
    return;
  }

  const user = findUserById(req.params.id);
  if (!user) {
    res.status(404).json({ message: 'User not found', statusCode: 404 });
    return;
  }

  const { email, firstName, lastName, password, isActive, isAdmin } = req.body;

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
  if (password !== undefined) user.password = password;
  if (isActive !== undefined) user.isActive = isActive;
  if (isAdmin !== undefined) user.isAdmin = isAdmin;
  user.updatedAt = new Date().toISOString();

  res.json(toUserResponse(user));
});

// DELETE /api/v1/users/:id
router.delete('/:id', (req, res) => {
  const admin = requireAdmin(req);
  if ('error' in admin) {
    const msg = admin.error === 403 ? 'Forbidden' : 'Unauthorized';
    res.status(admin.error).json({ message: msg, statusCode: admin.error });
    return;
  }

  const state = getState();
  if (!state.users.has(req.params.id)) {
    res.status(404).json({ message: 'User not found', statusCode: 404 });
    return;
  }

  state.users.delete(req.params.id);
  state.oauthAccounts.delete(req.params.id);

  res.json({});
});

export default router;
