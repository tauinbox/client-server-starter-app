import { Router, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  DEFAULT_SESSION_ABSOLUTE_MAX_MS,
  EMAIL_CHANGE_TOKEN_EXPIRY_MS,
  ErrorKeys,
  LOCKOUT_DURATION_MS,
  MAX_CONCURRENT_SESSIONS,
  MAX_FAILED_ATTEMPTS,
  MAX_PASSWORD_LENGTH,
  MFA_PENDING_TOKEN_EXPIRY_SECONDS,
  RESET_TOKEN_EXPIRY_MS,
  STEP_UP_OPERATION,
  VERIFICATION_TOKEN_EXPIRY_MS
} from '@app/shared/constants';
import isLength from 'validator/lib/isLength';
import { normalizeEmail } from '@app/shared/utils/email';
import {
  EMAIL_MAX_LENGTH,
  emailErrors,
  passwordLengthError,
  validateLocale,
  validateMaxLength
} from '../utils/validation';
import {
  generateMfaPendingToken,
  generateSessionId,
  generateTokens
} from '../jwt.utils';
import {
  breachedPasswordEnvelope,
  isBreachedPassword
} from '../helpers/breached-password.helpers';
import {
  endSessionOfToken,
  findUserByEmail,
  findUserById,
  getPackedRulesForUser,
  getState,
  isMfaMandatoryFor,
  logAudit,
  registerSession,
  sessionAgeMs,
  toUserResponse
} from '../state';
import { normalizeUserAgent } from '../utils/user-agent';
import {
  authGuard,
  clearMailedProofs,
  permissionGuard,
  pruneOldestUserTokens
} from '../helpers/auth.helpers';
import {
  buildMockUser,
  validateCreateUserBody
} from '../helpers/user-create.helpers';
import { resolveEntitlementLimit } from './billing.middleware';
import {
  CAPTCHA_ROUTE_LIMITS,
  evaluateCaptcha,
  trackAttemptAndSetHeader
} from '../helpers/captcha.helpers';
import type { AuthenticatedRequest } from '../types';
import { validationError } from '../helpers/validation-error.helpers';
import {
  OAUTH_INTENT_COOKIE_PATH,
  OAUTH_LINK_COOKIE,
  OAUTH_REAUTH_COOKIE,
  REAUTH_PROOF_COOKIE,
  REAUTH_PROOF_COOKIE_PATH,
  REFRESH_COOKIE_OPTIONS,
  REFRESH_TOKEN_COOKIE
} from '../constants';
import {
  isValidReauthProof,
  logStepUpFailure,
  sendWithRetryAfter,
  stepUpPasswordError
} from '../helpers/reauth.helpers';

/**
 * The 423 answer. It carries the standard Retry-After header, which the
 * server sets from the same value in its exception filter.
 */
function respondLocked(res: Response, lockedUntil: string): void {
  const retryAfter = Math.max(
    0,
    Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 1000)
  );
  res.setHeader('Retry-After', String(retryAfter));
  res.status(423).json({
    message:
      'Account is temporarily locked due to too many failed login attempts',
    lockedUntil,
    retryAfter,
    errorKey: ErrorKeys.AUTH.ACCOUNT_LOCKED
  });
}

function respondInvalidCredentials(
  res: Response,
  email: string,
  failedLoginAttempts: number | null,
  ip: string | undefined
): void {
  logAudit('USER_LOGIN_FAILURE', {
    actorEmail: email,
    details: {
      reason: 'invalid_credentials',
      ...(failedLoginAttempts !== null ? { failedLoginAttempts } : {})
    },
    ip
  });
  res.status(401).json({
    message: 'Invalid credentials',
    statusCode: 401,
    errorKey: ErrorKeys.AUTH.INVALID_CREDENTIALS
  });
}

const router = Router();

// GET /api/v1/auth/captcha-config — public configuration consumed by the client
router.get('/captcha-config', (_req, res) => {
  const state = getState();
  res.json({
    enabled: state.captchaConfig.enabled,
    provider: 'turnstile',
    siteKey: state.captchaConfig.siteKey
  });
});

// POST /api/v1/auth/register
router.post('/register', (req, res) => {
  const remaining = trackAttemptAndSetHeader(
    CAPTCHA_ROUTE_LIMITS['register'],
    req.ip ?? '',
    res
  );
  const captchaCheck = evaluateCaptcha(remaining, req.body?.captchaToken);
  if (!captchaCheck.ok) {
    res.status(captchaCheck.status).json(captchaCheck.body);
    return;
  }

  const validated = validateCreateUserBody(req.body);
  if (!validated.ok) {
    // Registering against a taken address is the cheapest account-existence
    // probe there is, so the conflict is audited even though the request fails.
    // The admin create route shares this helper and is deliberately not logged.
    if (validated.status === 409) {
      logAudit('USER_REGISTER_CONFLICT', {
        actorEmail: normalizeEmail(req.body?.email) ?? null,
        ip: req.ip
      });
    }
    res.status(validated.status).json(validated.body);
    return;
  }

  const user = buildMockUser(validated.fields, { isEmailVerified: false });

  const state = getState();
  state.users.set(user.id, user);

  // Store a verification token (plain UUID — no hashing in mock)
  const verificationToken = uuidv4();
  state.emailVerificationTokens.set(verificationToken, {
    userId: user.id,
    expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS).toISOString()
  });

  logAudit('USER_REGISTER', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    ip: req.ip
  });

  const verifyUrl = `http://localhost:4200/verify-email?token=${verificationToken}`;
  console.log(
    `[EMAIL VERIFICATION] To: ${user.email}\n  Verify URL: ${verifyUrl}`
  );

  res.status(201).json({
    message:
      'Registration successful. Please check your email to verify your account.'
  });
});

// POST /api/v1/auth/login
router.post('/login', (req, res) => {
  // No DTO validation here: the real login route has no `@Body()` parameter
  // (guards run before pipes), so a malformed address or an over-long password
  // is just another failed credential - 401, never 400. Values over the
  // `LoginDto` caps collapse to '' exactly like the server's LocalStrategy, so
  // the audit row never carries an oversized address.
  const rawEmail = normalizeEmail(req.body.email) ?? '';
  const email = isLength(rawEmail, { max: EMAIL_MAX_LENGTH }) ? rawEmail : '';
  const password =
    typeof req.body.password === 'string' &&
    isLength(req.body.password, { max: MAX_PASSWORD_LENGTH })
      ? req.body.password
      : '';

  const user = findUserByEmail(email);

  // Plaintext comparison - mock only. Real server uses bcrypt.compare().
  if (!user || !user.isActive || !user.password) {
    respondInvalidCredentials(res, email, null, req.ip);
    return;
  }

  if (user.lockedUntil) {
    if (new Date(user.lockedUntil).getTime() > Date.now()) {
      // Same order as the server: the lock answers before the password is
      // checked, so it cannot tell a caller which guess was right.
      logAudit('USER_LOGIN_FAILURE', {
        actorEmail: email,
        targetId: user.id,
        targetType: 'User',
        details: { reason: 'account_locked' },
        ip: req.ip
      });
      respondLocked(res, user.lockedUntil);
      return;
    }
    user.lockedUntil = null;
    user.failedLoginAttempts = 0;
  }

  if (user.password !== password) {
    user.failedLoginAttempts++;

    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = new Date(
        Date.now() + LOCKOUT_DURATION_MS
      ).toISOString();
      logAudit('USER_LOGIN_FAILURE', {
        actorEmail: email,
        targetId: user.id,
        targetType: 'User',
        details: {
          reason: 'account_locked_after_max_attempts',
          failedLoginAttempts: user.failedLoginAttempts
        },
        ip: req.ip
      });
      respondLocked(res, user.lockedUntil);
      return;
    }
    respondInvalidCredentials(res, email, user.failedLoginAttempts, req.ip);
    return;
  }

  // Before the verification check, as on the server: five correct passwords
  // must not lock an unverified account.
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;

  // Check email verification
  if (!user.isEmailVerified) {
    res.status(403).json({
      message: 'Please verify your email address before logging in',
      errorKey: ErrorKeys.AUTH.EMAIL_NOT_VERIFIED
    });
    return;
  }

  // An account that carries a second factor is not signed in yet. A correct
  // password buys only the right to present a code, so no session and no
  // success entry are produced here.
  if (user.totpEnabledAt) {
    res.json({
      mfaRequired: true,
      mfaToken: generateMfaPendingToken(user),
      expiresIn: MFA_PENDING_TOKEN_EXPIRY_SECONDS
    });
    return;
  }

  const state = getState();

  const sessionId = generateSessionId();
  const tokens = generateTokens(user, sessionId);
  state.refreshTokens.set(tokens.refresh_token, user.id);
  registerSession(
    tokens.refresh_token,
    sessionId,
    normalizeUserAgent(req.headers['user-agent'])
  );
  // Concurrent-session allowance is plan-driven; a plan carrying no `sessions`
  // limit (Free, usage) keeps the constant, exactly as the server resolves it.
  pruneOldestUserTokens(
    state.refreshTokens,
    user.id,
    resolveEntitlementLimit(user.id, 'sessions') ?? MAX_CONCURRENT_SESSIONS
  );

  logAudit('USER_LOGIN_SUCCESS', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    ip: req.ip
  });

  const { refresh_token, ...publicTokens } = tokens;
  res.cookie(REFRESH_TOKEN_COOKIE, refresh_token, REFRESH_COOKIE_OPTIONS);
  res.json({ tokens: publicTokens, user: toUserResponse(user) });
});

// POST /api/v1/auth/verify-email
router.post('/verify-email', (req, res) => {
  const { token } = req.body;

  if (!token) {
    res.status(400).json(validationError('Token is required'));
    return;
  }

  const tokenLenError = validateMaxLength(token, 512, 'token');
  if (tokenLenError) {
    res.status(400).json(validationError(tokenLenError));
    return;
  }

  const state = getState();
  const issued = state.emailVerificationTokens.get(token);

  if (!issued) {
    res.status(400).json({
      message: 'Invalid or expired verification token',
      errorKey: ErrorKeys.AUTH.INVALID_VERIFICATION_TOKEN
    });
    return;
  }

  const user = findUserById(issued.userId);
  if (!user) {
    res.status(400).json({
      message: 'Invalid or expired verification token',
      errorKey: ErrorKeys.AUTH.INVALID_VERIFICATION_TOKEN
    });
    return;
  }

  if (new Date(issued.expiresAt).getTime() < Date.now()) {
    res.status(400).json({
      message: 'Verification token has expired. Please request a new one.',
      errorKey: ErrorKeys.AUTH.VERIFICATION_TOKEN_EXPIRED
    });
    return;
  }

  user.isEmailVerified = true;
  state.emailVerificationTokens.delete(token);

  res.json({ message: 'Email verified successfully' });
});

// POST /api/v1/auth/resend-verification
router.post('/resend-verification', (req, res) => {
  const remaining = trackAttemptAndSetHeader(
    CAPTCHA_ROUTE_LIMITS['resend-verification'],
    req.ip ?? '',
    res
  );
  const captchaCheck = evaluateCaptcha(remaining, req.body?.captchaToken);
  if (!captchaCheck.ok) {
    res.status(captchaCheck.status).json(captchaCheck.body);
    return;
  }

  const successMessage =
    'If an account with that email exists and is not yet verified, a verification email has been sent.';

  // The DTO carries no `@IsOptional()`, so an absent address is a 400 here and
  // never the enumeration-safe success message.
  const bodyEmailErrors = emailErrors('email', req.body?.email);
  if (bodyEmailErrors.length > 0) {
    res.status(400).json(validationError(bodyEmailErrors));
    return;
  }

  const email = normalizeEmail(req.body.email) ?? '';
  const user = findUserByEmail(email);

  // Always return success to prevent email enumeration. A deactivated account
  // gets no new token either, matching the isActive gate in forgot-password:
  // the address it would verify still cannot sign in.
  if (!user || !user.isActive || user.isEmailVerified) {
    res.json({ message: successMessage });
    return;
  }

  const state = getState();

  // Remove any existing verification token for this user
  for (const [token, issued] of state.emailVerificationTokens.entries()) {
    if (issued.userId === user.id) {
      state.emailVerificationTokens.delete(token);
    }
  }

  // Create new verification token
  const verificationToken = uuidv4();
  state.emailVerificationTokens.set(verificationToken, {
    userId: user.id,
    expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS).toISOString()
  });

  const verifyUrl = `http://localhost:4200/verify-email?token=${verificationToken}`;
  console.log(`[EMAIL VERIFICATION] To: ${email}\n  Verify URL: ${verifyUrl}`);

  res.json({ message: successMessage });
});

// POST /api/v1/auth/forgot-password
router.post('/forgot-password', (req, res) => {
  const remaining = trackAttemptAndSetHeader(
    CAPTCHA_ROUTE_LIMITS['forgot-password'],
    req.ip ?? '',
    res
  );
  const captchaCheck = evaluateCaptcha(remaining, req.body?.captchaToken);
  if (!captchaCheck.ok) {
    res.status(captchaCheck.status).json(captchaCheck.body);
    return;
  }

  const successMessage =
    'If an account with that email exists, a password reset link has been sent.';

  // The DTO carries no `@IsOptional()`, so an absent address is a 400 here and
  // never the enumeration-safe success message.
  const bodyEmailErrors = emailErrors('email', req.body?.email);
  if (bodyEmailErrors.length > 0) {
    res.status(400).json(validationError(bodyEmailErrors));
    return;
  }

  const email = normalizeEmail(req.body.email) ?? '';

  const user = findUserByEmail(email);

  // Always return success to prevent email enumeration
  if (!user || !user.isActive) {
    res.json({ message: successMessage });
    return;
  }

  const state = getState();

  // Remove any existing reset token for this user
  for (const [token, issued] of state.passwordResetTokens.entries()) {
    if (issued.userId === user.id) {
      state.passwordResetTokens.delete(token);
    }
  }

  // Create new reset token
  const resetToken = uuidv4();
  state.passwordResetTokens.set(resetToken, {
    userId: user.id,
    expiresAt: new Date(Date.now() + RESET_TOKEN_EXPIRY_MS).toISOString()
  });

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
    res.status(400).json(validationError('Token and password are required'));
    return;
  }

  const tokenLenError = validateMaxLength(token, 512, 'token');
  if (tokenLenError) {
    res.status(400).json(validationError(tokenLenError));
    return;
  }

  const pwLenErr = passwordLengthError(password);
  if (pwLenErr) {
    res.status(400).json(validationError(pwLenErr));
    return;
  }

  const state = getState();
  const issued = state.passwordResetTokens.get(token);

  if (!issued) {
    res.status(400).json({
      message: 'Invalid or expired password reset token',
      errorKey: ErrorKeys.AUTH.INVALID_RESET_TOKEN
    });
    return;
  }

  const user = findUserById(issued.userId);

  // Deactivation must also void a reset token issued while the account was
  // still active, matching the isActive gate in forgot-password. The response
  // stays identical to the not-found case so it reveals no account state.
  if (!user || !user.isActive) {
    res.status(400).json({
      message: 'Invalid or expired password reset token',
      errorKey: ErrorKeys.AUTH.INVALID_RESET_TOKEN
    });
    return;
  }

  if (new Date(issued.expiresAt).getTime() < Date.now()) {
    res.status(400).json({
      message: 'Password reset token has expired. Please request a new one.',
      errorKey: ErrorKeys.AUTH.RESET_TOKEN_EXPIRED
    });
    return;
  }

  // The server checks the blocklist inside the service, after the token checks
  // that authorise the call: an invalid token must not buy a lookup.
  if (isBreachedPassword(password)) {
    res.status(400).json(breachedPasswordEnvelope());
    return;
  }

  // Update password
  user.password = password;
  user.tokenRevokedAt = new Date().toISOString();
  user.updatedAt = new Date().toISOString();

  // Proving mailbox ownership outranks the failed-guess counter: without this
  // the reset succeeds and the new password is still answered 423.
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;

  // Redeeming the token is the same proof of mailbox control that the
  // verification link carries: it is only ever mailed to the address on the row.
  user.isEmailVerified = true;

  // Cancel any in-flight self-service email change — proof of email ownership
  // is invalidated when password ownership changes.
  if (user.pendingEmailToken) {
    state.pendingEmailTokens.delete(user.pendingEmailToken);
  }
  user.pendingEmail = null;
  user.pendingEmailToken = null;
  user.pendingEmailExpiresAt = null;

  // Clear the reset token
  state.passwordResetTokens.delete(token);

  // Invalidate all refresh tokens for this user (active + revoked)
  for (const [rt, uid] of state.refreshTokens.entries()) {
    if (uid === user.id) {
      state.refreshTokens.delete(rt);
    }
  }
  for (const [rt, uid] of state.revokedRefreshTokens.entries()) {
    if (uid === user.id) {
      state.revokedRefreshTokens.delete(rt);
    }
  }

  logAudit('PASSWORD_RESET_COMPLETE', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    ip: req.ip
  });

  console.log(
    `[PASSWORD CHANGED] To: ${user.email}\n  Source: reset link | IP: ${req.ip}`
  );

  res.json({ message: 'Password has been reset successfully' });
});

function revokeAllUserSessions(userId: string): void {
  const state = getState();
  for (const [rt, uid] of state.refreshTokens.entries()) {
    if (uid === userId) state.refreshTokens.delete(rt);
  }
  for (const [rt, uid] of state.revokedRefreshTokens.entries()) {
    if (uid === userId) state.revokedRefreshTokens.delete(rt);
  }
  const user = findUserById(userId);
  if (user) user.tokenRevokedAt = new Date().toISOString();
}

// POST /api/v1/auth/refresh-token
router.post('/refresh-token', (req, res) => {
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[
    REFRESH_TOKEN_COOKIE
  ];

  if (!cookieToken) {
    // The server throws a bare UnauthorizedException here, before the service
    // runs, so this refusal carries no errorKey.
    res.status(401).json({
      message: 'Refresh token is required',
      statusCode: 401
    });
    return;
  }

  const state = getState();

  // OAuth 2.0 BCP — refresh-token reuse detection. If a token was rotated
  // (moved to revokedRefreshTokens) and is presented again, treat as a
  // possible compromise: revoke ALL sessions for the user.
  const reusedUserId = state.revokedRefreshTokens.get(cookieToken);
  if (reusedUserId) {
    logAudit('TOKEN_REUSE_DETECTED', {
      actorId: reusedUserId,
      targetId: reusedUserId,
      targetType: 'User',
      ip: req.ip
    });
    revokeAllUserSessions(reusedUserId);
    res.status(401).json({
      message: 'Invalid refresh token',
      statusCode: 401,
      errorKey: ErrorKeys.AUTH.INVALID_REFRESH_TOKEN
    });
    return;
  }

  const userId = state.refreshTokens.get(cookieToken);
  if (!userId) {
    logAudit('TOKEN_REFRESH_FAILURE', {
      details: { reason: 'invalid_or_expired_token' },
      ip: req.ip
    });
    res.status(401).json({
      message: 'Invalid refresh token',
      statusCode: 401,
      errorKey: ErrorKeys.AUTH.INVALID_REFRESH_TOKEN
    });
    return;
  }

  // Absolute session timeout. The server reads SESSION_ABSOLUTE_MAX_MS against
  // the `session_started_at` column; the mock carries the same default and the
  // same order, after the reuse detector.
  if (sessionAgeMs(cookieToken) >= DEFAULT_SESSION_ABSOLUTE_MAX_MS) {
    endSessionOfToken(cookieToken);
    logAudit('TOKEN_REFRESH_FAILURE', {
      actorId: userId,
      details: { reason: 'session_absolute_lifetime_exceeded' },
      ip: req.ip
    });
    res.status(401).json({
      message: 'Session has reached its maximum duration. Please log in again.',
      statusCode: 401,
      errorKey: ErrorKeys.AUTH.SESSION_EXPIRED
    });
    return;
  }

  const user = findUserById(userId);
  if (!user) {
    logAudit('TOKEN_REFRESH_FAILURE', {
      actorId: userId,
      details: { reason: 'user_not_found' },
      ip: req.ip
    });
    res.status(401).json({
      message: 'User not found',
      statusCode: 401,
      errorKey: ErrorKeys.AUTH.USER_NOT_FOUND
    });
    return;
  }

  if (!user.isActive) {
    // The server revokes the row and keeps it, so a later replay of the same
    // token still reaches the reuse detector.
    state.refreshTokens.delete(cookieToken);
    state.revokedRefreshTokens.set(cookieToken, user.id);
    logAudit('TOKEN_REFRESH_FAILURE', {
      actorId: user.id,
      actorEmail: user.email,
      details: { reason: 'user_deactivated' },
      ip: req.ip
    });
    res.status(401).json({
      message: 'User account is deactivated',
      statusCode: 401,
      errorKey: ErrorKeys.AUTH.USER_DEACTIVATED
    });
    return;
  }

  // Rotate: move old token to revoked map (kept for reuse detection)
  // and issue a fresh pair.
  const sessionId =
    state.refreshSessions.get(cookieToken) ?? generateSessionId();
  state.refreshTokens.delete(cookieToken);
  state.revokedRefreshTokens.set(cookieToken, user.id);

  // Rotation stays inside one session, so the access token another tab of this
  // device still holds keeps working.
  const tokens = generateTokens(user, sessionId);
  state.refreshTokens.set(tokens.refresh_token, user.id);
  // The binding of the revoked ancestor stays: a session ends as a whole, and
  // `endSessionOfToken` needs the ancestors to clear the reuse-detection map
  // too. Liveness reads the active map only, so this keeps nothing alive.
  registerSession(tokens.refresh_token, sessionId);

  const { refresh_token, ...publicTokens } = tokens;
  res.cookie(REFRESH_TOKEN_COOKIE, refresh_token, REFRESH_COOKIE_OPTIONS);
  res.json({ tokens: publicTokens, user: toUserResponse(user) });
});

// Mirrors `clearOAuthLinkCookie` on the server: an abandoned provider link or
// step-up must not outlive the session that started it.
function clearOAuthIntentCookies(res: Response): void {
  res.clearCookie(OAUTH_LINK_COOKIE, { path: OAUTH_INTENT_COOKIE_PATH });
  res.clearCookie(OAUTH_REAUTH_COOKIE, { path: OAUTH_INTENT_COOKIE_PATH });
  res.clearCookie(REAUTH_PROOF_COOKIE, { path: REAUTH_PROOF_COOKIE_PATH });
}

// POST /api/v1/auth/logout
router.post('/logout', authGuard, (req, res) => {
  const { user } = req as AuthenticatedRequest;

  // Per device, not per account: the other sessions of this user stay, and no
  // `tokenRevokedAt` is stamped. A cookie that never arrived ends nothing.
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[
    REFRESH_TOKEN_COOKIE
  ];
  const ownsToken =
    cookieToken !== undefined &&
    getState().refreshTokens.get(cookieToken) === user.id;
  const endedSession = ownsToken ? endSessionOfToken(cookieToken) : false;

  logAudit('USER_LOGOUT', {
    actorId: user.id,
    actorEmail: user.email,
    details: { scope: endedSession ? 'session' : 'none' },
    ip: req.ip
  });

  res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/api/v1/auth' });
  clearOAuthIntentCookies(res);
  res.setHeader('Clear-Site-Data', '"cache", "cookies"');
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
  res.json({
    roles: user.roles,
    rules,
    mfaMandatory: isMfaMandatoryFor(user)
  });
});

/**
 * Mirrors `@ValidateIf(propertyIsDefined) @IsNotEmpty() @MaxLength(255)` on
 * `UpdateProfileDto`. An omitted field is skipped, an explicit null is not.
 * Decorators apply bottom-up, so MaxLength is reported before IsNotEmpty.
 */
function profileNameErrors(field: string, value: unknown): string[] {
  if (value === undefined) return [];
  const errors: string[] = [];
  const tooLong = validateMaxLength(value, 255, field);
  if (tooLong) errors.push(tooLong);
  if (value === '' || value === null) {
    errors.push(`${field} should not be empty`);
  }
  return errors;
}

// PATCH /api/v1/auth/profile
// The server route carries `@SkipMfaEnrolmentGate()`: an account that owes an
// enrolment may still set the password that the enrolment step-up needs.
router.patch(
  '/profile',
  permissionGuard('update', 'Profile', { skipMfaEnrolmentGate: true }),
  (req, res) => {
    const { firstName, lastName, password, currentPassword, locale } = req.body;
    const { user } = req as AuthenticatedRequest;

    const localeErr = validateLocale(locale);
    if (localeErr) {
      res.status(400).json(validationError(localeErr));
      return;
    }

    const nameErrors = [
      ...profileNameErrors('firstName', firstName),
      ...profileNameErrors('lastName', lastName)
    ];
    if (nameErrors.length > 0) {
      res.status(400).json(validationError(nameErrors));
      return;
    }

    if (password !== undefined) {
      const pwLenErr = passwordLengthError(password);
      if (pwLenErr) {
        res.status(400).json(validationError(pwLenErr));
        return;
      }

      // A first password binds a credential that outlives the session, so an
      // account that holds no password proves itself with a provider proof, and
      // an account that holds one supplies it.
      if (user.password === null) {
        const proof = (req.cookies as Record<string, string> | undefined)?.[
          REAUTH_PROOF_COOKIE
        ];
        if (!isValidReauthProof(proof, user, STEP_UP_OPERATION.PASSWORD_SET)) {
          logStepUpFailure(
            req,
            user,
            STEP_UP_OPERATION.PASSWORD_SET,
            'reauth_proof',
            false
          );
          res.status(400).json({
            message:
              'Confirm it is you with your sign-in provider, then try again',
            statusCode: 400,
            errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED
          });
          return;
        }
      } else {
        const stepUp = stepUpPasswordError(
          req,
          user,
          currentPassword,
          STEP_UP_OPERATION.PASSWORD_SET,
          false
        );
        if (stepUp) {
          sendWithRetryAfter(res, stepUp);
          return;
        }
      }

      // The blocklist verdict comes from UsersService.update on the real server,
      // after the step up and before any field assignment, so a 400 must leave
      // the profile unchanged.
      if (isBreachedPassword(password)) {
        res.status(400).json(breachedPasswordEnvelope());
        return;
      }
    }

    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (locale !== undefined) user.locale = locale as string;
    if (password !== undefined) {
      user.password = password;
      user.tokenRevokedAt = new Date().toISOString();
      clearMailedProofs(user);

      logAudit('PASSWORD_CHANGE', {
        actorId: user.id,
        actorEmail: user.email,
        targetId: user.id,
        targetType: 'User',
        details: { source: 'self' },
        ip: req.ip
      });

      console.log(
        `[PASSWORD CHANGED] To: ${user.email}\n  Source: profile page | IP: ${req.ip}`
      );

      // Invalidate all refresh tokens on password change (matches real server)
      const state = getState();
      for (const [rt, uid] of state.refreshTokens.entries()) {
        if (uid === user.id) {
          state.refreshTokens.delete(rt);
        }
      }
      for (const [rt, uid] of state.revokedRefreshTokens.entries()) {
        if (uid === user.id) {
          state.revokedRefreshTokens.delete(rt);
        }
      }
      res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/api/v1/auth' });
      clearOAuthIntentCookies(res);
      // Cleared only now, so a rejected attempt keeps its remaining proof window.
      res.clearCookie(REAUTH_PROOF_COOKIE, { path: REAUTH_PROOF_COOKIE_PATH });
    }
    user.updatedAt = new Date().toISOString();

    res.json(toUserResponse(user));
  }
);

// POST /api/v1/auth/profile/email/initiate
router.post('/profile/email/initiate', authGuard, (req, res) => {
  const { user } = req as AuthenticatedRequest;
  const { currentPassword } = req.body;
  const successMessage =
    'If the new email is available, a confirmation link has been sent to it.';

  const newEmailErrors = emailErrors('newEmail', req.body?.newEmail);
  if (newEmailErrors.length > 0) {
    res.status(400).json(validationError(newEmailErrors));
    return;
  }

  const newEmail = normalizeEmail(req.body.newEmail) ?? '';
  // Supplied values are still checked; an absent one reaches the step-up gate,
  // which is the only place that knows which factor this account holds.
  if (
    currentPassword !== undefined &&
    (typeof currentPassword !== 'string' ||
      currentPassword.length === 0 ||
      currentPassword.length > MAX_PASSWORD_LENGTH)
  ) {
    res.status(400).json(validationError('currentPassword is required'));
    return;
  }

  if (user.password === null) {
    const proof = (req.cookies as Record<string, string> | undefined)?.[
      REAUTH_PROOF_COOKIE
    ];
    if (!isValidReauthProof(proof, user, STEP_UP_OPERATION.EMAIL_CHANGE)) {
      logStepUpFailure(
        req,
        user,
        STEP_UP_OPERATION.EMAIL_CHANGE,
        'reauth_proof',
        false
      );
      res.status(400).json({
        message: 'Confirm it is you with your sign-in provider, then try again',
        statusCode: 400,
        errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED
      });
      return;
    }
  } else {
    const stepUp = stepUpPasswordError(
      req,
      user,
      currentPassword,
      STEP_UP_OPERATION.EMAIL_CHANGE,
      false
    );
    if (stepUp) {
      sendWithRetryAfter(res, stepUp);
      return;
    }
  }

  if (newEmail === user.email) {
    res.status(400).json({
      message: 'New email is the same as the current email',
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.SAME_EMAIL
    });
    return;
  }

  const state = getState();

  // The server clears the proof once the change is accepted, so a rejected
  // attempt keeps its remaining window. Everything above this line rejects.
  res.clearCookie(REAUTH_PROOF_COOKIE, { path: REAUTH_PROOF_COOKIE_PATH });

  // Uniqueness check: primary email OR pending email on any OTHER user.
  let conflict = false;
  for (const other of state.users.values()) {
    if (other.id === user.id || other.deletedAt) continue;
    if (other.email === newEmail || other.pendingEmail === newEmail) {
      conflict = true;
      break;
    }
  }

  const domain = newEmail.slice(newEmail.indexOf('@') + 1);
  logAudit('USER_EMAIL_CHANGE_REQUEST', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    details: { newEmailDomain: domain, conflict },
    ip: req.ip
  });

  if (conflict) {
    res.json({ message: successMessage });
    return;
  }

  // Drop any previous pending token for this user (idempotent re-initiate)
  if (user.pendingEmailToken) {
    state.pendingEmailTokens.delete(user.pendingEmailToken);
  }

  // No hashing in the mock — store the raw token directly.
  const token = uuidv4();
  user.pendingEmail = newEmail;
  user.pendingEmailToken = token;
  user.pendingEmailExpiresAt = new Date(
    Date.now() + EMAIL_CHANGE_TOKEN_EXPIRY_MS
  ).toISOString();
  state.pendingEmailTokens.set(token, user.id);

  const confirmUrl = `http://localhost:4200/confirm-email-change?token=${token}`;
  console.log(
    `[EMAIL CHANGE CONFIRMATION] To: ${newEmail}\n  Confirm URL: ${confirmUrl}`
  );
  console.log(
    `[EMAIL CHANGE NOTIFICATION] To: ${user.email}\n  Pending new address requested`
  );

  res.json({ message: successMessage });
});

// POST /api/v1/auth/profile/email/confirm
router.post('/profile/email/confirm', (req, res) => {
  const { token } = req.body;

  if (!token || typeof token !== 'string') {
    res.status(400).json(validationError('Token is required'));
    return;
  }

  const tokenLenError = validateMaxLength(token, 512, 'token');
  if (tokenLenError) {
    res.status(400).json(validationError(tokenLenError));
    return;
  }

  const state = getState();
  const userId = state.pendingEmailTokens.get(token);
  if (!userId) {
    res.status(400).json({
      message: 'Invalid or expired email-change token',
      errorKey: ErrorKeys.AUTH.PENDING_EMAIL_TOKEN_EXPIRED,
      statusCode: 400
    });
    return;
  }

  const user = findUserById(userId);
  // Deactivation must also void an email-change token issued while the account
  // was still active, matching the isActive gate in reset-password. The
  // response stays identical to the not-found case so it reveals no account
  // state, and the token is left in place exactly as the server leaves the
  // column, so a later re-activation behaves the same in both.
  if (user && !user.isActive) {
    res.status(400).json({
      message: 'Invalid or expired email-change token',
      errorKey: ErrorKeys.AUTH.PENDING_EMAIL_TOKEN_EXPIRED,
      statusCode: 400
    });
    return;
  }

  if (!user || !user.pendingEmail) {
    state.pendingEmailTokens.delete(token);
    res.status(400).json({
      message: 'Invalid or expired email-change token',
      errorKey: ErrorKeys.AUTH.PENDING_EMAIL_TOKEN_EXPIRED,
      statusCode: 400
    });
    return;
  }

  if (
    user.pendingEmailExpiresAt &&
    new Date(user.pendingEmailExpiresAt).getTime() < Date.now()
  ) {
    state.pendingEmailTokens.delete(token);
    user.pendingEmail = null;
    user.pendingEmailToken = null;
    user.pendingEmailExpiresAt = null;
    res.status(400).json({
      message: 'Email-change token has expired. Please request a new one.',
      errorKey: ErrorKeys.AUTH.PENDING_EMAIL_TOKEN_EXPIRED,
      statusCode: 400
    });
    return;
  }

  // Race check: another user may have claimed the address since step 1.
  for (const other of state.users.values()) {
    if (other.id === user.id || other.deletedAt) continue;
    if (other.email === user.pendingEmail) {
      state.pendingEmailTokens.delete(token);
      user.pendingEmail = null;
      user.pendingEmailToken = null;
      user.pendingEmailExpiresAt = null;
      res.status(409).json({
        message: 'User with this email already exists',
        statusCode: 409,
        errorKey: ErrorKeys.USERS.EMAIL_EXISTS
      });
      return;
    }
  }

  const oldEmail = user.email;
  const newEmail = user.pendingEmail;

  user.email = newEmail;
  user.isEmailVerified = true;
  user.pendingEmail = null;
  user.pendingEmailToken = null;
  user.pendingEmailExpiresAt = null;
  user.tokenRevokedAt = new Date().toISOString();
  user.updatedAt = new Date().toISOString();
  state.pendingEmailTokens.delete(token);

  // Invalidate all refresh tokens — the JWT email claim is stale.
  for (const [rt, uid] of state.refreshTokens.entries()) {
    if (uid === user.id) state.refreshTokens.delete(rt);
  }
  for (const [rt, uid] of state.revokedRefreshTokens.entries()) {
    if (uid === user.id) state.revokedRefreshTokens.delete(rt);
  }

  logAudit('USER_EMAIL_CHANGE_COMPLETE', {
    actorId: user.id,
    actorEmail: newEmail,
    targetId: user.id,
    targetType: 'User',
    details: { oldEmail, newEmail },
    ip: req.ip
  });

  console.log(
    `[EMAIL CHANGE COMPLETE] To: ${oldEmail}\n  New address: ${newEmail}`
  );

  res.json({
    message: 'Email has been updated. Please sign in again with your new email.'
  });
});

export default router;
