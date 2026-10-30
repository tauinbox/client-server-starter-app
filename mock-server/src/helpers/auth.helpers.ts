import { subject as caslSubject } from '@casl/ability';
import type { Request, Response, NextFunction } from 'express';
import { validateToken, type DecodedToken } from '../jwt.utils';
import { ErrorKeys, TOKEN_PURPOSE, type ErrorKey } from '@app/shared/constants';
import { issuedBeforeRevocation } from '@app/shared/utils/token-revocation';
import {
  buildAbilityForUser,
  endSessionOfToken,
  findUserById,
  getState,
  isSessionLive,
  logAudit,
  mustEnrolMfa
} from '../state';
import type { Actions, SubjectNames } from '../state';
import type { AuthenticatedRequest, MockUser } from '../types';
import { sendError } from './error-envelope.helpers';

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

type AuthResult = { user: MockUser; decoded: DecodedToken; sessionId: string };
type AuthRefusal = { refusal: { errorKey?: ErrorKey; message: string } };

// Passport answers a missing, unreadable or expired token before
// `JwtStrategy.validate` runs, with no key.
const KEYLESS_REFUSAL: AuthRefusal = { refusal: { message: 'Unauthorized' } };

function refuse(errorKey: ErrorKey, message: string): AuthRefusal {
  return { refusal: { errorKey, message } };
}

/** Mirrors `JwtStrategy.validate`: the same checks in the same order. */
export function authenticateRequest(req: Request): AuthResult | AuthRefusal {
  const token = extractBearerToken(req);
  if (!token) return KEYLESS_REFUSAL;

  const decoded = validateToken(token);
  if (!decoded) return KEYLESS_REFUSAL;

  if (decoded.purpose !== TOKEN_PURPOSE.ACCESS) {
    return refuse(ErrorKeys.AUTH.INVALID_TOKEN, 'Token is not an access token');
  }
  if (typeof decoded.sub !== 'string' || decoded.sub === '') {
    return refuse(
      ErrorKeys.AUTH.INVALID_TOKEN,
      'Token is missing a valid subject claim'
    );
  }
  if (typeof decoded.iat !== 'number' || !Number.isFinite(decoded.iat)) {
    return refuse(
      ErrorKeys.AUTH.INVALID_TOKEN,
      'Token is missing a valid issued-at claim'
    );
  }

  const user = findUserById(decoded.sub);
  if (!user) return refuse(ErrorKeys.AUTH.USER_NOT_FOUND, 'User not found');

  if (issuedBeforeRevocation(decoded.iat, user.tokenRevokedAt)) {
    return refuse(ErrorKeys.AUTH.TOKEN_REVOKED, 'Token has been revoked');
  }

  if (typeof decoded.sid !== 'string' || decoded.sid === '') {
    return refuse(
      ErrorKeys.AUTH.INVALID_TOKEN,
      'Token is missing a valid session claim'
    );
  }
  if (!isSessionLive(decoded.sid)) {
    return refuse(ErrorKeys.AUTH.TOKEN_REVOKED, 'Session has ended');
  }

  return { user, decoded, sessionId: decoded.sid };
}

/** For a route that serves an anonymous caller too: a refused token is anonymous. */
export function optionalAuthentication(req: Request): AuthResult | null {
  const result = authenticateRequest(req);
  return 'refusal' in result ? null : result;
}

export function requireAuth(req: Request): AuthResult | GuardError {
  const result = authenticateRequest(req);
  if ('refusal' in result) return { error: 401, ...result.refusal };
  return result;
}

/**
 * Mirrors `refuseAccess` on the server: every authorization refusal writes its
 * row with the caller ip. The mock keeps no request id, so that stays null.
 */
export function logRefusal(
  req: Request,
  actorId: string,
  row: {
    action?: 'PERMISSION_CHECK_FAILURE' | 'PERMISSION_GRANT_DENIED';
    targetId?: string | null;
    targetType?: string | null;
    details: Record<string, unknown>;
  }
): void {
  logAudit(row.action ?? 'PERMISSION_CHECK_FAILURE', {
    actorId,
    targetId: row.targetId ?? null,
    targetType: row.targetType ?? null,
    details: row.details,
    ip: req.ip
  });
}

export type GuardError = {
  error: number;
  message: string;
  errorKey?: ErrorKey;
};

function sendGuardError(res: Response, result: GuardError): void {
  if (result.errorKey) {
    sendError(res, result.errorKey, result.message);
    return;
  }
  // Passport sends this Unauthorized with no key.
  res.status(result.error).json({ message: result.message });
}

/**
 * Mirrors the three layers that `@Authorize` composes on the server:
 * JwtAuthGuard, then MfaRequiredGuard, then PermissionsGuard. The last layer is
 * a type-level CASL check, so a route that also needs the record itself runs a
 * second check inside the handler, exactly as the server controllers do.
 */
export interface PermissionGuardOptions {
  /** Mirrors `@SkipMfaEnrolmentGate()` on the server route. */
  skipMfaEnrolmentGate?: boolean;
}

export function requirePermission(
  action: Actions,
  subject: SubjectNames,
  options: PermissionGuardOptions = {}
): (req: Request) => AuthResult | GuardError {
  return (req) => {
    const result = requireAuth(req);
    if ('error' in result) return result;

    // Mirrors MfaRequiredGuard, which travels with @Authorize on the server.
    if (!options.skipMfaEnrolmentGate && mustEnrolMfa(result.user)) {
      logRefusal(req, result.user.id, {
        details: {
          required: [`${action}:${subject}`],
          mfaEnrolmentRequired: true
        }
      });
      return {
        error: 403,
        message:
          'Two-factor authentication must be turned on before this account can use the administration surface',
        errorKey: ErrorKeys.AUTH.MFA_ENROLMENT_REQUIRED
      };
    }

    if (!buildAbilityForUser(result.user).can(action, subject)) {
      // PermissionsGuard writes this row before it throws, and carries only the
      // required tuple. It passes no actorEmail, so the server row holds null
      // there.
      logRefusal(req, result.user.id, {
        details: { required: [`${action}:${subject}`] }
      });
      return {
        error: 403,
        message: 'Insufficient permissions',
        errorKey: ErrorKeys.GENERAL.INSUFFICIENT_PERMISSIONS
      };
    }

    return result;
  };
}

/** Express middleware — requires authenticated user, attaches req.user */
export function authGuard(req: Request, res: Response, next: NextFunction) {
  const result = requireAuth(req);
  if ('error' in result) {
    sendGuardError(res, result);
    return;
  }
  (req as AuthenticatedRequest).user = result.user;
  (req as AuthenticatedRequest).sessionId = result.sessionId;
  next();
}

/** Express middleware - requires one CASL permission, attaches req.user */
export function permissionGuard(
  action: Actions,
  subject: SubjectNames,
  options: PermissionGuardOptions = {}
) {
  const check = requirePermission(action, subject, options);
  return (req: Request, res: Response, next: NextFunction) => {
    const result = check(req);
    if ('error' in result) {
      sendGuardError(res, result);
      return;
    }
    (req as AuthenticatedRequest).user = result.user;
    (req as AuthenticatedRequest).sessionId = result.sessionId;
    next();
  };
}

/**
 * Mirrors the controller-level `assertCan` on the server. The route guard is a
 * type-level check that ignores conditions, so a conditional grant has to be
 * re-evaluated against the record the caller submits. Answers
 * `INSUFFICIENT_PERMISSIONS` and returns false when the caller may not act on
 * that record.
 *
 * `targetType` is the audited entity name, which is not always the CASL subject:
 * the rbac routes authorize `Permission` while the server audits `Resource` or
 * `Action`. It defaults to the subject, which is the server's own fallback.
 */
export function assertInstancePermission(
  req: Request,
  res: Response,
  action: Actions,
  subjectName: SubjectNames,
  record: object,
  targetType: string = subjectName
): boolean {
  const { user } = req as AuthenticatedRequest;
  if (buildAbilityForUser(user).can(action, caslSubject(subjectName, record))) {
    return true;
  }
  // Mirrors assertCan, which audits before it throws. It passes no actorEmail.
  // A create route submits a record with no id, which is why targetId reads
  // off the record itself.
  logRefusal(req, user.id, {
    targetId: (record as { id?: string }).id ?? null,
    targetType,
    details: {
      instanceCheck: true,
      deniedAction: action,
      subject: subjectName
    }
  });
  sendError(
    res,
    ErrorKeys.GENERAL.INSUFFICIENT_PERMISSIONS,
    'Insufficient permissions'
  );
  return false;
}

export function isActorSuper(req: unknown): boolean {
  const actor = (req as AuthenticatedRequest).user;
  if (!actor) return false;
  return roleNamesAreSuper(actor.roles);
}

function roleNamesAreSuper(roleNames: string[]): boolean {
  return Array.from(getState().roles.values()).some(
    (r) => r.isSuper && roleNames.includes(r.name)
  );
}

/**
 * Mirrors `UsersService.assertCanWrite`: the instance check, then the rule
 * that an account holding a super role is out of reach of every actor that is
 * not super itself. Answers `INSUFFICIENT_PERMISSIONS` or
 * `SUPER_TARGET_FORBIDDEN` and returns false on a refusal.
 */
export function assertCanWriteUser(
  req: Request,
  res: Response,
  action: 'update' | 'delete',
  target: MockUser
): boolean {
  if (!assertInstancePermission(req, res, action, 'User', target)) {
    return false;
  }
  if (isActorSuper(req) || !roleNamesAreSuper(target.roles)) {
    return true;
  }
  logRefusal(req, (req as AuthenticatedRequest).user.id, {
    targetId: target.id,
    targetType: 'User',
    details: {
      instanceCheck: true,
      deniedAction: action,
      subject: 'User',
      superTarget: true
    }
  });
  sendError(
    res,
    ErrorKeys.USERS.SUPER_TARGET_FORBIDDEN,
    'Only a super actor can modify a super account'
  );
  return false;
}

/**
 * Concurrent-session cap, applied wherever a session is created. The oldest
 * sessions end whole, with their rotated ancestors, as
 * `RefreshTokenService.pruneOldestTokens` does.
 */
export function pruneOldestUserTokens(
  userId: string,
  maxSessions: number
): void {
  const userTokens: string[] = [];
  for (const [token, uid] of getState().refreshTokens.entries()) {
    if (uid === userId) userTokens.push(token);
  }
  if (userTokens.length > maxSessions) {
    const excess = userTokens.length - maxSessions;
    for (let i = 0; i < excess; i++) {
      endSessionOfToken(userTokens[i]);
    }
  }
}

// Mirrors the server: a password change, an email move, a deactivation and a
// soft delete null the reset columns and the pending-email trio in the same
// write, so a link mailed before the change cannot take the account after it.
export function clearMailedProofs(user: MockUser): void {
  const state = getState();
  for (const [token, issued] of state.passwordResetTokens.entries()) {
    if (issued.userId === user.id) {
      state.passwordResetTokens.delete(token);
    }
  }
  if (user.pendingEmailToken) {
    state.pendingEmailTokens.delete(user.pendingEmailToken);
  }
  user.pendingEmail = null;
  user.pendingEmailToken = null;
  user.pendingEmailExpiresAt = null;
}
