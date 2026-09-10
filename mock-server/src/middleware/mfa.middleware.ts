import { Router } from 'express';
import {
  ErrorKeys,
  LOCKOUT_DURATION_MS,
  MAX_CONCURRENT_SESSIONS,
  MAX_FAILED_ATTEMPTS,
  STEP_UP_OPERATION,
  TOKEN_PURPOSE,
  TOTP_DIGITS,
  TOTP_ISSUER
} from '@app/shared/constants';
import { authGuard, pruneOldestUserTokens } from '../helpers/auth.helpers';
import {
  consumeTotpCode,
  isValidPasswordShape,
  normalize,
  stepUpError
} from '../helpers/reauth.helpers';
import { validationError } from '../helpers/validation-error.helpers';
import { decodeToken, generateSessionId, generateTokens } from '../jwt.utils';
import {
  findUserById,
  getState,
  logAudit,
  registerSession,
  toUserResponse
} from '../state';
import { resolveEntitlementLimit } from './billing.middleware';
import {
  MOCK_RECOVERY_CODES,
  MOCK_REGENERATED_RECOVERY_CODES,
  MOCK_TOTP_QR_DATA_URL,
  MOCK_TOTP_SECRET,
  REFRESH_COOKIE_OPTIONS,
  REFRESH_TOKEN_COOKIE
} from '../constants';
import type { AuthenticatedRequest, MockUser } from '../types';
import type { Request, Response } from 'express';

const router = Router();

const invalidCodeEnvelope = {
  message: 'Verification code is incorrect',
  statusCode: 401,
  errorKey: ErrorKeys.AUTH.MFA_INVALID_CODE
};

const invalidPendingTokenEnvelope = {
  message: 'Two-factor sign-in is invalid or has expired',
  statusCode: 401,
  errorKey: ErrorKeys.AUTH.MFA_INVALID_PENDING_TOKEN
};

/**
 * The route throttles are keyed by client address, so they bound one caller and
 * not one account. This is the brake the source address cannot move: it mirrors
 * the server `FailedAttemptCounter` on the challenge route only. The recovery
 * route stays open on purpose, so a caller who holds only the password can
 * never deny the owner every way in.
 */
function readChallengeFailures(userId: string): {
  count: number;
  remainingMs: number;
} {
  const open = getState().mfaChallengeFailures.get(userId);
  const now = Date.now();
  if (!open || open.expiresAt <= now) return { count: 0, remainingMs: 0 };
  return { count: open.count, remainingMs: open.expiresAt - now };
}

function recordChallengeFailure(userId: string): {
  count: number;
  remainingMs: number;
} {
  const windows = getState().mfaChallengeFailures;
  const now = Date.now();
  const open = windows.get(userId);
  // The window is set when it opens and never extended, so a caller who keeps
  // trying cannot be barred past the duration.
  const entry =
    open && open.expiresAt > now
      ? open
      : { count: 0, expiresAt: now + LOCKOUT_DURATION_MS };
  entry.count += 1;
  windows.set(userId, entry);
  return { count: entry.count, remainingMs: entry.expiresAt - now };
}

function clearChallengeFailures(userId: string): void {
  getState().mfaChallengeFailures.delete(userId);
}

function challengeLockedEnvelope(remainingMs: number): Record<string, unknown> {
  return {
    message:
      'Too many incorrect verification codes. Use a recovery code or try again later',
    statusCode: 423,
    errorKey: ErrorKeys.AUTH.MFA_CHALLENGE_LOCKED,
    lockedUntil: new Date(Date.now() + remainingMs).toISOString(),
    retryAfter: Math.max(1, Math.ceil(remainingMs / 1000))
  };
}

function isValidCodeShape(value: unknown): value is string {
  return typeof value === 'string' && value.length === TOTP_DIGITS;
}

/** Resolves the account behind an mfa-pending token, or null. */
function userFromPendingToken(mfaToken: unknown): MockUser | null {
  if (typeof mfaToken !== 'string') return null;

  const decoded = decodeToken(mfaToken);
  if (
    !decoded ||
    decoded.purpose !== TOKEN_PURPOSE.MFA_PENDING ||
    typeof decoded.sub !== 'string' ||
    decoded.sub === '' ||
    typeof decoded.iat !== 'number' ||
    decoded.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  const user = findUserById(decoded.sub);
  if (!user || !user.isActive || !user.totpEnabledAt) return null;

  // A sign-out everywhere since the password check must end this attempt
  // too. The floor mirrors the server: it keeps a token minted inside the
  // same second as the sign-out usable.
  if (
    user.tokenRevokedAt &&
    decoded.iat < Math.floor(new Date(user.tokenRevokedAt).getTime() / 1000)
  ) {
    return null;
  }

  return user;
}

/** The sign-in the password alone did not buy. */
function issueSession(req: Request, res: Response, user: MockUser): void {
  const state = getState();
  const sessionId = generateSessionId();
  const tokens = generateTokens(user, sessionId);
  state.refreshTokens.set(tokens.refresh_token, user.id);
  registerSession(tokens.refresh_token, sessionId);
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
    details: { factor: 'mfa' },
    ip: req.ip
  });

  const { refresh_token, ...publicTokens } = tokens;
  res.cookie(REFRESH_TOKEN_COOKIE, refresh_token, REFRESH_COOKIE_OPTIONS);
  res.json({ tokens: publicTokens, user: toUserResponse(user) });
}

// POST /api/v1/auth/mfa/setup
router.post('/setup', authGuard, (req, res) => {
  const { user } = req as AuthenticatedRequest;
  const { currentPassword } = req.body;

  if (currentPassword !== undefined && !isValidPasswordShape(currentPassword)) {
    res.status(400).json(validationError('currentPassword is required'));
    return;
  }

  const stepUp = stepUpError(
    req,
    user,
    currentPassword,
    undefined,
    STEP_UP_OPERATION.MFA_SETUP
  );
  if (stepUp) {
    res.status(stepUp.statusCode).json(stepUp);
    return;
  }

  if (user.totpEnabledAt) {
    res.status(409).json({
      message: 'Two-factor authentication is already enabled',
      statusCode: 409,
      errorKey: ErrorKeys.AUTH.MFA_ALREADY_ENABLED
    });
    return;
  }

  user.totpSecret = MOCK_TOTP_SECRET;
  user.totpEnabledAt = null;
  user.totpRecoveryCodes = null;
  // A fresh enrolment must not inherit the floor of the secret it replaces.
  user.totpLastUsedStep = null;

  res.json({
    secret: MOCK_TOTP_SECRET,
    otpauthUri: `otpauth://totp/${TOTP_ISSUER}:${encodeURIComponent(
      user.email
    )}?secret=${MOCK_TOTP_SECRET}&issuer=${TOTP_ISSUER}`,
    qrDataUrl: MOCK_TOTP_QR_DATA_URL
  });
});

// POST /api/v1/auth/mfa/enable
router.post('/enable', authGuard, (req, res) => {
  const { user } = req as AuthenticatedRequest;
  const { code } = req.body;

  if (!isValidCodeShape(code)) {
    res
      .status(400)
      .json(
        validationError(
          `code must be longer than or equal to ${TOTP_DIGITS} characters`
        )
      );
    return;
  }

  if (user.totpEnabledAt) {
    res.status(409).json({
      message: 'Two-factor authentication is already enabled',
      statusCode: 409,
      errorKey: ErrorKeys.AUTH.MFA_ALREADY_ENABLED
    });
    return;
  }

  if (user.totpSecret === null) {
    res.status(400).json({
      message: 'Start the two-factor setup before you confirm a code',
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.MFA_SETUP_REQUIRED
    });
    return;
  }

  if (!consumeTotpCode(user, code)) {
    logAudit('MFA_CHALLENGE_FAILURE', {
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      details: { stage: 'enrolment' },
      ip: req.ip
    });
    res.status(401).json(invalidCodeEnvelope);
    return;
  }

  user.totpEnabledAt = new Date().toISOString();
  user.totpRecoveryCodes = [...MOCK_RECOVERY_CODES];

  logAudit('MFA_ENABLE', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    ip: req.ip
  });

  console.log(`[MFA ENABLED] To: ${user.email}`);

  res.json({ recoveryCodes: [...MOCK_RECOVERY_CODES] });
});

// POST /api/v1/auth/mfa/disable
router.post('/disable', authGuard, (req, res) => {
  const { user } = req as AuthenticatedRequest;
  const { currentPassword, code } = req.body;

  if (currentPassword !== undefined && !isValidPasswordShape(currentPassword)) {
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

  const stepUp = stepUpError(
    req,
    user,
    currentPassword,
    code,
    STEP_UP_OPERATION.MFA_DISABLE
  );
  if (stepUp) {
    res.status(stepUp.statusCode).json(stepUp);
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

  user.totpSecret = null;
  user.totpEnabledAt = null;
  user.totpRecoveryCodes = null;
  user.totpLastUsedStep = null;

  logAudit('MFA_DISABLE', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    ip: req.ip
  });

  console.log(`[MFA DISABLED] To: ${user.email}`);

  res.json({ message: 'Two-factor authentication has been turned off' });
});

// POST /api/v1/auth/mfa/recovery-codes
router.post('/recovery-codes', authGuard, (req, res) => {
  const { user } = req as AuthenticatedRequest;
  const { currentPassword, code } = req.body;

  if (currentPassword !== undefined && !isValidPasswordShape(currentPassword)) {
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

  const stepUp = stepUpError(
    req,
    user,
    currentPassword,
    code,
    STEP_UP_OPERATION.MFA_RECOVERY_CODES
  );
  if (stepUp) {
    res.status(stepUp.statusCode).json(stepUp);
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

  user.totpRecoveryCodes = [...MOCK_REGENERATED_RECOVERY_CODES];

  logAudit('MFA_RECOVERY_CODES_REGENERATED', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    ip: req.ip
  });

  console.log(`[MFA RECOVERY CODES REPLACED] To: ${user.email}`);

  res.json({ recoveryCodes: [...MOCK_REGENERATED_RECOVERY_CODES] });
});

// POST /api/v1/auth/mfa/verify
router.post('/verify', (req, res) => {
  const { mfaToken, code } = req.body;

  if (typeof mfaToken !== 'string' || mfaToken.length === 0) {
    res.status(400).json(validationError('mfaToken should not be empty'));
    return;
  }
  if (!isValidCodeShape(code)) {
    res
      .status(400)
      .json(
        validationError(
          `code must be longer than or equal to ${TOTP_DIGITS} characters`
        )
      );
    return;
  }

  const user = userFromPendingToken(mfaToken);
  if (!user) {
    res.status(401).json(invalidPendingTokenEnvelope);
    return;
  }

  const open = readChallengeFailures(user.id);
  if (open.count >= MAX_FAILED_ATTEMPTS) {
    res.status(423).json(challengeLockedEnvelope(open.remainingMs));
    return;
  }

  if (!consumeTotpCode(user, code)) {
    const { count, remainingMs } = recordChallengeFailure(user.id);
    logAudit('MFA_CHALLENGE_FAILURE', {
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      details: { stage: 'challenge', attempt: count },
      ip: req.ip
    });
    if (count >= MAX_FAILED_ATTEMPTS) {
      res.status(423).json(challengeLockedEnvelope(remainingMs));
      return;
    }
    res.status(401).json(invalidCodeEnvelope);
    return;
  }

  clearChallengeFailures(user.id);
  issueSession(req, res, user);
});

// POST /api/v1/auth/mfa/recovery
router.post('/recovery', (req, res) => {
  const { mfaToken, recoveryCode } = req.body;

  if (typeof mfaToken !== 'string' || mfaToken.length === 0) {
    res.status(400).json(validationError('mfaToken should not be empty'));
    return;
  }
  if (
    typeof recoveryCode !== 'string' ||
    !/^[A-Za-z2-7]{8}-?[A-Za-z2-7]{8}$/.test(recoveryCode)
  ) {
    res
      .status(400)
      .json(
        validationError(
          'recoveryCode must match /^[A-Za-z2-7]{8}-?[A-Za-z2-7]{8}$/ regular expression'
        )
      );
    return;
  }

  const user = userFromPendingToken(mfaToken);
  if (!user) {
    res.status(401).json(invalidPendingTokenEnvelope);
    return;
  }

  const target = normalize(recoveryCode);
  const remaining = (user.totpRecoveryCodes ?? []).filter(
    (stored) => normalize(stored) !== target
  );

  if (remaining.length === (user.totpRecoveryCodes ?? []).length) {
    logAudit('MFA_CHALLENGE_FAILURE', {
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      details: { stage: 'recovery_code' },
      ip: req.ip
    });
    res.status(401).json({
      message: 'Recovery code is invalid or was already used',
      statusCode: 401,
      errorKey: ErrorKeys.AUTH.MFA_INVALID_RECOVERY_CODE
    });
    return;
  }

  user.totpRecoveryCodes = remaining;

  logAudit('MFA_RECOVERY_CODE_USED', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    details: { remaining: remaining.length },
    ip: req.ip
  });

  clearChallengeFailures(user.id);
  issueSession(req, res, user);
});

export default router;
