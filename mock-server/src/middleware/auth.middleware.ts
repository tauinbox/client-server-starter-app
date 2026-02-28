import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  MAX_CONCURRENT_SESSIONS
} from '@app/shared/constants/auth.constants';
import {
  PASSWORD_REGEX,
  PASSWORD_ERROR
} from '@app/shared/constants/password.constants';
import {
  isValidEmail,
  validateMaxLength,
  validateMinLength
} from '../utils/validation';
import { generateTokens } from '../jwt.utils';
import {
  findUserByEmail,
  findUserById,
  getPackedRulesForUser,
  getState,
  logAudit,
  toUserResponse
} from '../state';
import { authGuard } from '../helpers/auth.helpers';
import type { AuthenticatedRequest, MockUser } from '../types';

const router = Router();

function pruneOldestUserTokens(
  refreshTokens: Map<string, string>,
  userId: string,
  maxSessions: number
): void {
  const userTokens: string[] = [];
  for (const [token, uid] of refreshTokens.entries()) {
    if (uid === userId) userTokens.push(token);
  }
  if (userTokens.length > maxSessions) {
    const excess = userTokens.length - maxSessions;
    for (let i = 0; i < excess; i++) {
      refreshTokens.delete(userTokens[i]);
    }
  }
}

// POST /api/v1/auth/register
router.post('/register', (req, res) => {
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
    password, // Stored as plaintext — mock only. Real server uses bcrypt.
    isActive: true,
    roles: ['user'],
    isEmailVerified: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    tokenRevokedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };

  const state = getState();
  state.users.set(user.id, user);

  // Store a verification token (plain UUID — no hashing in mock)
  const verificationToken = uuidv4();
  state.emailVerificationTokens.set(verificationToken, user.id);

  logAudit('USER_REGISTER', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    ip: req.ip
  });

  const verifyUrl = `http://localhost:4200/verify-email?token=${verificationToken}`;
  console.log(`[EMAIL VERIFICATION] To: ${email}\n  Verify URL: ${verifyUrl}`);

  res.status(201).json({
    message:
      'Registration successful. Please check your email to verify your account.'
  });
});

// POST /api/v1/auth/login
router.post('/login', (req, res) => {
  const email = req.body.email?.trim().toLowerCase();
  const { password } = req.body;

  if (email && !isValidEmail(email)) {
    res
      .status(400)
      .json({ message: 'email must be an email', statusCode: 400 });
    return;
  }

  if (email) {
    const emailMaxErr = validateMaxLength(email, 255, 'email');
    if (emailMaxErr) {
      res.status(400).json({ message: emailMaxErr, statusCode: 400 });
      return;
    }
  }

  if (password) {
    const pwMaxErr = validateMaxLength(password, 128, 'password');
    if (pwMaxErr) {
      res.status(400).json({ message: pwMaxErr, statusCode: 400 });
      return;
    }
  }

  const user = findUserByEmail(email);

  // Check account lockout
  if (user && user.lockedUntil) {
    const lockedUntilTime = new Date(user.lockedUntil).getTime();
    if (lockedUntilTime > Date.now()) {
      const retryAfter = Math.ceil((lockedUntilTime - Date.now()) / 1000);
      logAudit('USER_LOGIN_FAILURE', {
        actorEmail: email,
        targetId: user.id,
        targetType: 'User',
        details: { reason: 'account_locked' },
        ip: req.ip
      });
      res.status(423).json({
        message:
          'Account is temporarily locked due to too many failed login attempts',
        lockedUntil: user.lockedUntil,
        retryAfter
      });
      return;
    }
    // Lock expired — clear it
    user.lockedUntil = null;
    user.failedLoginAttempts = 0;
  }

  // Plaintext comparison — mock only. Real server uses bcrypt.compare().
  if (!user || !user.isActive || user.password !== password) {
    // Handle failed login attempt tracking
    if (user && user.isActive) {
      user.failedLoginAttempts++;

      if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        user.lockedUntil = new Date(
          Date.now() + LOCKOUT_DURATION_MS
        ).toISOString();
        const retryAfter = Math.ceil(LOCKOUT_DURATION_MS / 1000);
        logAudit('USER_LOGIN_FAILURE', {
          actorEmail: email,
          targetId: user.id,
          targetType: 'User',
          details: { reason: 'account_locked_after_max_attempts' },
          ip: req.ip
        });
        res.status(423).json({
          message:
            'Account is temporarily locked due to too many failed login attempts',
          lockedUntil: user.lockedUntil,
          retryAfter
        });
        return;
      }
    }
    logAudit('USER_LOGIN_FAILURE', {
      actorEmail: email,
      details: { reason: 'invalid_credentials' },
      ip: req.ip
    });
    res.status(401).json({ message: 'Invalid credentials', statusCode: 401 });
    return;
  }

  // Check email verification
  if (!user.isEmailVerified) {
    res.status(403).json({
      message: 'Please verify your email address before logging in',
      errorCode: 'EMAIL_NOT_VERIFIED'
    });
    return;
  }

  // Success — reset failed attempts
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
  }

  const state = getState();

  const tokens = generateTokens(user);
  state.refreshTokens.set(tokens.refresh_token, user.id);
  pruneOldestUserTokens(state.refreshTokens, user.id, MAX_CONCURRENT_SESSIONS);

  logAudit('USER_LOGIN_SUCCESS', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    ip: req.ip
  });

  res.json({ tokens, user: toUserResponse(user) });
});

// POST /api/v1/auth/verify-email
router.post('/verify-email', (req, res) => {
  const { token } = req.body;

  if (!token) {
    res.status(400).json({ message: 'Token is required', statusCode: 400 });
    return;
  }

  const state = getState();
  const userId = state.emailVerificationTokens.get(token);

  if (!userId) {
    res.status(400).json({ message: 'Invalid or expired verification token' });
    return;
  }

  const user = findUserById(userId);
  if (!user) {
    res.status(400).json({ message: 'Invalid or expired verification token' });
    return;
  }

  user.isEmailVerified = true;
  state.emailVerificationTokens.delete(token);

  res.json({ message: 'Email verified successfully' });
});

// POST /api/v1/auth/resend-verification
router.post('/resend-verification', (req, res) => {
  const email = req.body.email?.trim().toLowerCase();

  const successMessage =
    'If an account with that email exists and is not yet verified, a verification email has been sent.';

  if (!email) {
    res.json({ message: successMessage });
    return;
  }

  if (!isValidEmail(email)) {
    res
      .status(400)
      .json({ message: 'email must be an email', statusCode: 400 });
    return;
  }

  const user = findUserByEmail(email);

  // Always return success to prevent email enumeration
  if (!user || user.isEmailVerified) {
    res.json({ message: successMessage });
    return;
  }

  const state = getState();

  // Remove any existing verification token for this user
  for (const [token, uid] of state.emailVerificationTokens.entries()) {
    if (uid === user.id) {
      state.emailVerificationTokens.delete(token);
    }
  }

  // Create new verification token
  const verificationToken = uuidv4();
  state.emailVerificationTokens.set(verificationToken, user.id);

  const verifyUrl = `http://localhost:4200/verify-email?token=${verificationToken}`;
  console.log(`[EMAIL VERIFICATION] To: ${email}\n  Verify URL: ${verifyUrl}`);

  res.json({ message: successMessage });
});

// POST /api/v1/auth/forgot-password
router.post('/forgot-password', (req, res) => {
  const email = req.body.email?.trim().toLowerCase();

  const successMessage =
    'If an account with that email exists, a password reset link has been sent.';

  if (!email) {
    res.json({ message: successMessage });
    return;
  }

  if (!isValidEmail(email)) {
    res
      .status(400)
      .json({ message: 'email must be an email', statusCode: 400 });
    return;
  }

  const user = findUserByEmail(email);

  // Always return success to prevent email enumeration
  if (!user || !user.isActive) {
    res.json({ message: successMessage });
    return;
  }

  const state = getState();

  // Remove any existing reset token for this user
  for (const [token, uid] of state.passwordResetTokens.entries()) {
    if (uid === user.id) {
      state.passwordResetTokens.delete(token);
    }
  }

  // Create new reset token
  const resetToken = uuidv4();
  state.passwordResetTokens.set(resetToken, user.id);

  logAudit('PASSWORD_RESET_REQUEST', {
    actorEmail: email,
    targetId: user.id,
    targetType: 'User',
    ip: req.ip
  });

  const resetUrl = `http://localhost:4200/reset-password?token=${resetToken}`;
  console.log(`[PASSWORD RESET] To: ${email}\n  Reset URL: ${resetUrl}`);

  res.json({ message: successMessage });
});

// POST /api/v1/auth/reset-password
router.post('/reset-password', (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    res
      .status(400)
      .json({ message: 'Token and password are required', statusCode: 400 });
    return;
  }

  const pwMinErr = validateMinLength(password, 8, 'password');
  const pwMaxErr = validateMaxLength(password, 128, 'password');
  if (pwMinErr || pwMaxErr) {
    res.status(400).json({ message: pwMinErr || pwMaxErr, statusCode: 400 });
    return;
  }

  if (!PASSWORD_REGEX.test(password)) {
    res.status(400).json({ message: PASSWORD_ERROR, statusCode: 400 });
    return;
  }

  const state = getState();
  const userId = state.passwordResetTokens.get(token);

  if (!userId) {
    res
      .status(400)
      .json({ message: 'Invalid or expired password reset token' });
    return;
  }

  const user = findUserById(userId);
  if (!user) {
    res
      .status(400)
      .json({ message: 'Invalid or expired password reset token' });
    return;
  }

  // Update password
  user.password = password;
  user.tokenRevokedAt = new Date().toISOString();
  user.updatedAt = new Date().toISOString();

  // Clear the reset token
  state.passwordResetTokens.delete(token);

  // Invalidate all refresh tokens for this user
  for (const [rt, uid] of state.refreshTokens.entries()) {
    if (uid === user.id) {
      state.refreshTokens.delete(rt);
    }
  }

  logAudit('PASSWORD_RESET_COMPLETE', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    ip: req.ip
  });

  res.json({ message: 'Password has been reset successfully' });
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
    logAudit('TOKEN_REFRESH_FAILURE', {
      details: { reason: 'invalid_or_expired_token' },
      ip: req.ip
    });
    res.status(401).json({ message: 'Invalid refresh token', statusCode: 401 });
    return;
  }

  const user = findUserById(userId);
  if (!user || !user.isActive) {
    logAudit('TOKEN_REFRESH_FAILURE', {
      actorId: userId,
      details: {
        reason: !user ? 'user_not_found' : 'user_deactivated'
      },
      ip: req.ip
    });
    state.refreshTokens.delete(refresh_token);
    res.status(401).json({ message: 'Invalid refresh token', statusCode: 401 });
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
router.post('/logout', authGuard, (req, res) => {
  const { user } = req as AuthenticatedRequest;

  // Remove all refresh tokens for this user and revoke access tokens
  const state = getState();
  for (const [token, userId] of state.refreshTokens.entries()) {
    if (userId === user.id) {
      state.refreshTokens.delete(token);
    }
  }
  user.tokenRevokedAt = new Date().toISOString();

  logAudit('USER_LOGOUT', {
    actorId: user.id,
    actorEmail: user.email,
    ip: req.ip
  });

  res.json({ message: 'Successfully logged out' });
});

// GET /api/v1/auth/profile
router.get('/profile', authGuard, (req, res) => {
  const { user } = req as AuthenticatedRequest;
  res.json(toUserResponse(user));
});

// GET /api/v1/auth/permissions
router.get('/permissions', authGuard, (req, res) => {
  const { user } = req as AuthenticatedRequest;
  const rules = getPackedRulesForUser(user);
  res.json({ roles: user.roles, rules });
});

// PATCH /api/v1/auth/profile
router.patch('/profile', authGuard, (req, res) => {
  const { firstName, lastName, password } = req.body;
  const { user } = req as AuthenticatedRequest;

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

  if (firstName !== undefined) user.firstName = firstName;
  if (lastName !== undefined) user.lastName = lastName;
  if (password !== undefined) {
    if (!PASSWORD_REGEX.test(password)) {
      res.status(400).json({ message: PASSWORD_ERROR, statusCode: 400 });
      return;
    }
    user.password = password;
    user.tokenRevokedAt = new Date().toISOString();

    logAudit('PASSWORD_CHANGE', {
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      details: { source: 'self' },
      ip: req.ip
    });

    // Invalidate all refresh tokens on password change (matches real server)
    const state = getState();
    for (const [rt, uid] of state.refreshTokens.entries()) {
      if (uid === user.id) {
        state.refreshTokens.delete(rt);
      }
    }
  }
  user.updatedAt = new Date().toISOString();

  res.json(toUserResponse(user));
});

export default router;
