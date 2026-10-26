import {
  ErrorKeys,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
  MAX_PASSWORD_LENGTH,
  STEP_UP_OPERATION,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS
} from '@app/shared/constants';
import { getState, logAudit } from '../state';
import {
  MOCK_TOTP_CODE,
  AUTH_COOKIE_PATH,
  REAUTH_PROOF_COOKIE
} from '../constants';
import type { Request, Response } from 'express';
import type { StepUpOperation } from '@app/shared/constants';
import { normalizeOtpCode } from '@app/shared/utils/otp-code';
import { issuedBeforeRevocation } from '@app/shared/utils/token-revocation';
import type { FailedAttemptWindow, MockUser } from '../types';
import {
  fixedLengthStringErrors,
  stringErrors,
  unknownPropertyErrors
} from '../utils/validation';
import type { OptionalMode } from '../utils/validation';

/**
 * The per-account failure window the server keeps in `FailedAttemptCounter`.
 * The map is the namespace: the caller passes the one it wants to brake, so
 * the sign-in challenge and the step-up code never share a budget.
 */
export function readFailures(
  windows: Map<string, FailedAttemptWindow>,
  userId: string
): { count: number; remainingMs: number } {
  const open = windows.get(userId);
  const now = Date.now();
  if (!open || open.expiresAt <= now) return { count: 0, remainingMs: 0 };
  return { count: open.count, remainingMs: open.expiresAt - now };
}

export function recordFailure(
  windows: Map<string, FailedAttemptWindow>,
  userId: string
): { count: number; remainingMs: number } {
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

export function clearFailures(
  windows: Map<string, FailedAttemptWindow>,
  userId: string
): void {
  windows.delete(userId);
}

/**
 * Retry-After is the standard carrier of a retry delay, and the server sets it
 * from the same body field in its exception filter.
 */
export function sendWithRetryAfter(
  res: Response,
  body: { statusCode: number; retryAfter?: number }
): void {
  if (body.retryAfter !== undefined) {
    res.setHeader('Retry-After', String(Math.max(0, body.retryAfter)));
  }
  res.status(body.statusCode).json(body);
}

/**
 * Mirrors the checks the server runs on a `reauth_proof` JWT: the proof names
 * this account and this operation, it has not expired, and it was not minted
 * before the last session revocation. The mock has no provider round trip to
 * produce one, so `POST /__control/reauth-proof` seeds it instead.
 *
 * The proof is single use. The server records the token id in a ledger; an
 * in-memory map is single use by construction once the record is deleted, and
 * the record is deleted last, so a proof offered for the wrong operation does
 * not burn the one the user still holds.
 */
export function isValidReauthProof(
  proof: string | undefined,
  user: MockUser,
  operation: StepUpOperation
): boolean {
  if (!proof) {
    return false;
  }

  const record = getState().reauthProofs.get(proof);
  if (!record || record.userId !== user.id || record.expiresAt < Date.now()) {
    return false;
  }

  if (record.operation !== operation) {
    return false;
  }

  if (issuedBeforeRevocation(record.issuedAt, user.tokenRevokedAt)) {
    return false;
  }

  getState().reauthProofs.delete(proof);
  return true;
}

/**
 * Called only after the change is accepted, so a rejected attempt keeps its
 * remaining proof window. The record is spent already; this stops the browser
 * from holding a credential that no longer works.
 */
export function clearReauthProofCookie(res: Response): void {
  res.clearCookie(REAUTH_PROOF_COOKIE, { path: AUTH_COOKIE_PATH });
}

/**
 * The audit row AuthService.assertStepUp writes when it refuses a caller. A
 * refused step-up authorises nothing, so no other row carries the attempt.
 * The value that was tried never enters the record.
 */
export function logStepUpFailure(
  req: Request,
  user: MockUser,
  operation: StepUpOperation,
  factor: 'password' | 'reauth_proof' | 'code',
  codeOffered: boolean
): void {
  logAudit('STEP_UP_FAILURE', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    details: { operation, factor, codeOffered },
    ip: req.ip
  });
}

/** Mirrors `@IsString() @Length(TOTP_DIGITS, TOTP_DIGITS)` on a `code`. */
export function totpCodeErrors(
  value: unknown,
  optional?: OptionalMode
): string[] {
  return fixedLengthStringErrors('code', value, TOTP_DIGITS, optional);
}

/**
 * Mirrors `@ValidateIf(propertyIsDefined) @IsString() @IsNotEmpty()
 * @MaxLength(MAX_PASSWORD_LENGTH)` on a `currentPassword`.
 */
export function currentPasswordErrors(value: unknown): string[] {
  return stringErrors('currentPassword', value, {
    max: MAX_PASSWORD_LENGTH,
    notEmpty: true,
    isStringOnTop: true,
    optional: 'definedOnly'
  });
}

/**
 * Mirrors the ValidationPipe on a DTO that carries `StepUpFactorsDto`: a field
 * outside `fields` and the two factors is reported first, as `whitelist` with
 * `forbidNonWhitelisted` does, then `fieldErrors` of the DTO's own fields, then
 * the factors. A supplied factor must have the shape of its field; an absent
 * one reaches the step-up, which is the only place that knows which factor the
 * account holds.
 */
export function stepUpFactorsBodyErrors(
  body: unknown,
  fields: readonly string[] = [],
  fieldErrors: readonly string[] = []
): string[] {
  const { currentPassword, code } = (body ?? {}) as Record<string, unknown>;
  return [
    ...unknownPropertyErrors(body, [...fields, 'currentPassword', 'code']),
    ...fieldErrors,
    ...currentPasswordErrors(currentPassword),
    ...totpCodeErrors(code, 'definedOnly')
  ];
}

/**
 * Verifies the fixed code and spends it, the way the server verifies a real
 * code and spends it. RFC 6238 section 5.2 forbids a second use of a code that
 * already validated, so an acceptance records its 30-second step and any later
 * acceptance at or below that step is refused.
 *
 * The mock has no secret to derive a step from, so it uses the step the
 * acceptance happens in. The property is the same: one code, one use.
 */
export function consumeTotpCode(user: MockUser, code: unknown): boolean {
  if (typeof code !== 'string' || normalizeOtpCode(code) !== MOCK_TOTP_CODE) {
    return false;
  }

  const step = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);
  if (user.totpLastUsedStep !== null && step <= user.totpLastUsedStep) {
    return false;
  }

  user.totpLastUsedStep = step;
  return true;
}

export interface StepUpErrorEnvelope {
  message: string;
  statusCode: number;
  errorKey: string;
  lockedUntil?: string;
  retryAfter?: number;
}

/**
 * The per-account brake on the step-up code, mirroring
 * `MfaService.isValidStepUpCode`. It answers `null` when the code proved the
 * caller and an envelope when the account is barred. It answers `'refused'`
 * for a wrong code and `undefined` for no code; both fall through to the
 * password or the provider proof.
 *
 * A step-up that offers no code never touches the counter, so an ordinary
 * password step-up cannot burn the budget of the account.
 */
function stepUpCodeError(
  req: Request,
  user: MockUser,
  code: unknown
): StepUpErrorEnvelope | null | 'refused' | undefined {
  if (!user.totpEnabledAt || !code) {
    return undefined;
  }

  const windows = getState().mfaStepUpFailures;
  const open = readFailures(windows, user.id);
  if (open.count >= MAX_FAILED_ATTEMPTS) {
    return stepUpLockedEnvelope(open.remainingMs);
  }

  if (!consumeTotpCode(user, code)) {
    const { count, remainingMs } = recordFailure(windows, user.id);
    logAudit('MFA_CHALLENGE_FAILURE', {
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      details: { stage: 'step_up', attempt: count },
      ip: req.ip
    });
    return count >= MAX_FAILED_ATTEMPTS
      ? stepUpLockedEnvelope(remainingMs)
      : 'refused';
  }

  clearFailures(windows, user.id);
  return null;
}

/** The 423 answer of every per-account brake, as the server `lockedException`. */
export function lockedEnvelope(
  message: string,
  errorKey: string,
  lockedUntil: Date
): StepUpErrorEnvelope {
  return {
    message,
    statusCode: 423,
    errorKey,
    lockedUntil: lockedUntil.toISOString(),
    retryAfter: Math.max(
      1,
      Math.ceil((lockedUntil.getTime() - Date.now()) / 1000)
    )
  };
}

/**
 * The step-up code is shut for the rest of the window. The message names no
 * recovery code: that route answers a sign-in challenge, and it opens no
 * step-up.
 */
function stepUpLockedEnvelope(remainingMs: number): StepUpErrorEnvelope {
  return lockedEnvelope(
    'Too many incorrect verification codes. Try again later',
    ErrorKeys.AUTH.MFA_STEP_UP_LOCKED,
    new Date(Date.now() + remainingMs)
  );
}

/**
 * The password factor of the step-up is shut for the rest of the window. The
 * key is not `ACCOUNT_LOCKED`: the sign-in card keys its countdown off that
 * one, and no step-up route has a sign-in to count down to.
 */
function stepUpPasswordLockedEnvelope(
  remainingMs: number
): StepUpErrorEnvelope {
  return lockedEnvelope(
    'Too many incorrect passwords. Try again later',
    ErrorKeys.AUTH.STEP_UP_LOCKED,
    new Date(Date.now() + remainingMs)
  );
}

/** A 400, not the 401 of the sign-in challenge, as the server answers. */
function invalidStepUpCodeEnvelope(): StepUpErrorEnvelope {
  return {
    message: 'Verification code is incorrect',
    statusCode: 400,
    errorKey: ErrorKeys.AUTH.MFA_INVALID_CODE
  };
}

function invalidCurrentPasswordEnvelope(): StepUpErrorEnvelope {
  return {
    message: 'Current password is incorrect',
    statusCode: 400,
    errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
  };
}

/**
 * Mirrors AuthService.assertStepUp: a code from the enrolled authenticator, a
 * password, or a provider proof, in that order. Returns an error envelope, or
 * null when the caller proved itself. A refusal writes the audit row the
 * server writes, because nothing else records the attempt.
 */
export function stepUpError(
  req: Request,
  user: MockUser,
  currentPassword: unknown,
  code: unknown,
  operation: StepUpOperation,
  // False on a route outside the path the proof cookie is scoped to, which a
  // browser never sends it to. The server passes no proof there.
  acceptsReauthProof = true
): StepUpErrorEnvelope | null {
  // ASVS 6.2.3, as on the server: an account that holds a password changes it
  // only against the current one.
  const codeVerdict = stepUpCodeError(
    req,
    user,
    operation === STEP_UP_OPERATION.PASSWORD_SET && user.password !== null
      ? undefined
      : code
  );
  if (codeVerdict !== undefined && codeVerdict !== 'refused') {
    return codeVerdict;
  }
  const codeRefused = codeVerdict === 'refused';

  if (user.password === null) {
    const proof = acceptsReauthProof
      ? (req.cookies as Record<string, string> | undefined)?.[
          REAUTH_PROOF_COOKIE
        ]
      : undefined;
    if (isValidReauthProof(proof, user, operation)) {
      return null;
    }

    if (codeRefused) {
      logStepUpFailure(req, user, operation, 'code', true);
      return invalidStepUpCodeEnvelope();
    }
    logStepUpFailure(req, user, operation, 'reauth_proof', code !== undefined);
    return {
      message: 'Confirm it is you with your sign-in provider, then try again',
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED
    };
  }

  return stepUpPasswordError(
    req,
    user,
    currentPassword,
    operation,
    code !== undefined,
    codeRefused
  );
}

/**
 * The per-account brake on the step-up password, mirroring the counter in
 * `AuthService.stepUpFailure`.
 *
 * A step-up that offers no password never touches the counter, so a route that
 * presents another factor cannot burn the budget of the account.
 */
function stepUpPasswordError(
  req: Request,
  user: MockUser,
  currentPassword: unknown,
  operation: StepUpOperation,
  codeOffered: boolean,
  codeRefused: boolean
): StepUpErrorEnvelope | null {
  if (!currentPassword) {
    if (codeRefused) {
      logStepUpFailure(req, user, operation, 'code', codeOffered);
      return invalidStepUpCodeEnvelope();
    }
    logStepUpFailure(req, user, operation, 'password', codeOffered);
    return invalidCurrentPasswordEnvelope();
  }

  const windows = getState().stepUpPasswordFailures;
  const open = readFailures(windows, user.id);
  if (open.count >= MAX_FAILED_ATTEMPTS) {
    return stepUpPasswordLockedEnvelope(open.remainingMs);
  }

  // Plaintext comparison - mock only. Real server uses bcrypt.compare().
  if (user.password === currentPassword) {
    clearFailures(windows, user.id);
    return null;
  }

  const { count, remainingMs } = recordFailure(windows, user.id);
  logStepUpFailure(req, user, operation, 'password', codeOffered);
  return count >= MAX_FAILED_ATTEMPTS
    ? stepUpPasswordLockedEnvelope(remainingMs)
    : invalidCurrentPasswordEnvelope();
}
