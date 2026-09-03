import { Router } from 'express';
import {
  ErrorKeys,
  MAX_CONCURRENT_SESSIONS,
  MAX_PASSWORD_LENGTH,
  STEP_UP_OPERATION,
  TOKEN_PURPOSE,
  TOTP_DIGITS,
  TOTP_ISSUER
} from '@app/shared/constants';
import { authGuard, pruneOldestUserTokens } from '../helpers/auth.helpers';
import { isValidReauthProof } from '../helpers/reauth.helpers';
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
  MOCK_TOTP_CODE,
  MOCK_TOTP_QR_DATA_URL,
  MOCK_TOTP_SECRET,
  REAUTH_PROOF_COOKIE,
  REFRESH_COOKIE_OPTIONS,
  REFRESH_TOKEN_COOKIE
} from '../constants';
import type { StepUpOperation } from '@app/shared/constants';
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

/** Normalises a code the way the server does before it compares anything. */
function normalize(value: string): string {
  return value.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

function isValidCodeShape(value: unknown): value is string {
  return typeof value === 'string' && value.length === TOTP_DIGITS;
}

function isValidPasswordShape(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PASSWORD_LENGTH
  );
}

/**
 * Mirrors AuthService.assertStepUp: a code from the enrolled authenticator, a
 * password, or a provider proof, in that order. Returns an error envelope, or
 * null when the caller proved itself.
 */
function stepUpError(
  req: Request,
  user: MockUser,
  currentPassword: unknown,
  code: unknown,
  operation: StepUpOperation
): { message: string; statusCode: number; errorKey: string } | null {
  if (
    user.totpEnabledAt &&
    typeof code === 'string' &&
    normalize(code) === MOCK_TOTP_CODE
  ) {
    return null;
  }

  if (user.password === null) {
    const proof = (req.cookies as Record<string, string> | undefined)?.[
      REAUTH_PROOF_COOKIE
    ];
    return isValidReauthProof(proof, user, operation)
      ? null
      : {
          message:
            'Confirm it is you with your sign-in provider, then try again',
          statusCode: 400,
          errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED
        };
  }

  // Plaintext comparison — mock only. Real server uses bcrypt.compare().
  return user.password === currentPassword
    ? null
    : {
        message: 'Current password is incorrect',
        statusCode: 400,
        errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
      };
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

  if (user.totpEnabledAt) {
    res.status(409).json({
      message: 'Two-factor authentication is already enabled',
      statusCode: 409,
      errorKey: ErrorKeys.AUTH.MFA_ALREADY_ENABLED
    });
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

  user.totpSecret = MOCK_TOTP_SECRET;
  user.totpEnabledAt = null;
  user.totpRecoveryCodes = null;

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

  if (normalize(code) !== MOCK_TOTP_CODE) {
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

  if (normalize(code) !== MOCK_TOTP_CODE) {
    logAudit('MFA_CHALLENGE_FAILURE', {
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      details: { stage: 'challenge' },
      ip: req.ip
    });
    res.status(401).json(invalidCodeEnvelope);
    return;
  }

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

  issueSession(req, res, user);
});

export default router;
