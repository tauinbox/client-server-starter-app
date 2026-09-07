import {
  ErrorKeys,
  MAX_PASSWORD_LENGTH,
  TOTP_PERIOD_SECONDS
} from '@app/shared/constants';
import { getState, logAudit } from '../state';
import { MOCK_TOTP_CODE, REAUTH_PROOF_COOKIE } from '../constants';
import type { Request } from 'express';
import type { StepUpOperation } from '@app/shared/constants';
import type { MockUser } from '../types';

/**
 * Mirrors the checks the server runs on a `reauth_proof` JWT: the proof names
 * this account and this operation, it has not expired, and it was not minted
 * before the last session revocation. The mock has no provider round trip to
 * produce one, so `POST /__control/reauth-proof` seeds it instead.
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

  if (
    user.tokenRevokedAt &&
    record.issuedAt < new Date(user.tokenRevokedAt).getTime() / 1000
  ) {
    return false;
  }

  return true;
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
  factor: 'password' | 'reauth_proof',
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

/** Normalises a code the way the server does before it compares anything. */
export function normalize(value: string): string {
  return value.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

export function isValidPasswordShape(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PASSWORD_LENGTH
  );
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
  if (typeof code !== 'string' || normalize(code) !== MOCK_TOTP_CODE) {
    return false;
  }

  const step = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);
  if (user.totpLastUsedStep !== null && step <= user.totpLastUsedStep) {
    return false;
  }

  user.totpLastUsedStep = step;
  return true;
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
  operation: StepUpOperation
): { message: string; statusCode: number; errorKey: string } | null {
  if (user.totpEnabledAt && consumeTotpCode(user, code)) {
    return null;
  }

  if (user.password === null) {
    const proof = (req.cookies as Record<string, string> | undefined)?.[
      REAUTH_PROOF_COOKIE
    ];
    if (isValidReauthProof(proof, user, operation)) {
      return null;
    }

    logStepUpFailure(req, user, operation, 'reauth_proof', code !== undefined);
    return {
      message: 'Confirm it is you with your sign-in provider, then try again',
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED
    };
  }

  // Plaintext comparison - mock only. Real server uses bcrypt.compare().
  if (user.password === currentPassword) {
    return null;
  }

  logStepUpFailure(req, user, operation, 'password', code !== undefined);
  return {
    message: 'Current password is incorrect',
    statusCode: 400,
    errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
  };
}
