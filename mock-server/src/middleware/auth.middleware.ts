import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { generateTokens } from '../jwt.utils';
import {
  findUserByEmail,
  findUserById,
  getState,
  toUserResponse
} from '../state';
import { requireAuth } from '../helpers/auth.helpers';
import type { MockUser } from '../types';

const router = Router();

// POST /api/v1/auth/register
router.post('/register', (req, res) => {
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

// POST /api/v1/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  const user = findUserByEmail(email);
  if (!user || user.password !== password) {
    res.status(401).json({ message: 'Invalid credentials', statusCode: 401 });
    return;
  }

  const tokens = generateTokens(user);
  getState().refreshTokens.set(tokens.refresh_token, user.id);

  res.json({ tokens, user: toUserResponse(user) });
});

// POST /api/v1/auth/refresh-token
router.post('/refresh-token', (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    res
      .status(401)
      .json({ message: 'Refresh token is required', statusCode: 401 });
    return;
  }

  const state = getState();
  const userId = state.refreshTokens.get(refresh_token);
  if (!userId) {
    res.status(401).json({ message: 'Invalid refresh token', statusCode: 401 });
    return;
  }

  const user = findUserById(userId);
  if (!user) {
    res.status(401).json({ message: 'User not found', statusCode: 401 });
    return;
  }

  // Remove old refresh token
  state.refreshTokens.delete(refresh_token);

  // Generate new tokens
  const tokens = generateTokens(user);
  state.refreshTokens.set(tokens.refresh_token, user.id);

  res.json({ tokens, user: toUserResponse(user) });
});

// POST /api/v1/auth/logout
router.post('/logout', (req, res) => {
  const auth = requireAuth(req);
  if ('error' in auth) {
    res
      .status(auth.error)
      .json({ message: 'Unauthorized', statusCode: auth.error });
    return;
  }

  // Remove all refresh tokens for this user
  const state = getState();
  for (const [token, userId] of state.refreshTokens.entries()) {
    if (userId === auth.user.id) {
      state.refreshTokens.delete(token);
    }
  }

  res.json({ message: 'Successfully logged out' });
});

// GET /api/v1/auth/profile
router.get('/profile', (req, res) => {
  const auth = requireAuth(req);
  if ('error' in auth) {
    res
      .status(auth.error)
      .json({ message: 'Unauthorized', statusCode: auth.error });
    return;
  }

  res.json(toUserResponse(auth.user));
});

// PATCH /api/v1/auth/profile
router.patch('/profile', (req, res) => {
  const auth = requireAuth(req);
  if ('error' in auth) {
    res
      .status(auth.error)
      .json({ message: 'Unauthorized', statusCode: auth.error });
    return;
  }

  const { firstName, lastName, password } = req.body;
  const user = auth.user;

  if (firstName !== undefined) user.firstName = firstName;
  if (lastName !== undefined) user.lastName = lastName;
  if (password !== undefined) user.password = password;
  user.updatedAt = new Date().toISOString();

  res.json(toUserResponse(user));
});

export default router;
