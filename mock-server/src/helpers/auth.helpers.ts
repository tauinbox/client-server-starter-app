import { subject as caslSubject } from '@casl/ability';
import type { Request, Response, NextFunction } from 'express';
import { validateToken, type DecodedToken } from '../jwt.utils';
import { ErrorKeys } from '@app/shared/constants';
import {
  buildAbilityForUser,
  findUserById,
  isSessionLive,
  mustEnrolMfa
} from '../state';
import type { Actions, SubjectNames } from '../state';
import type { AuthenticatedRequest, MockUser } from '../types';

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

export function authenticateRequest(
  req: Request
): { user: MockUser; decoded: DecodedToken } | null {
  const token = extractBearerToken(req);
  if (!token) return null;

  const decoded = validateToken(token);
  if (!decoded) return null;

  const user = findUserById(decoded.sub);
  if (!user) return null;

  if (
    user.tokenRevokedAt &&
    decoded.iat < new Date(user.tokenRevokedAt).getTime() / 1000
  ) {
    return null;
  }

  // Fail closed on a missing session claim, matching JwtStrategy: a token that
  // names no session cannot be ended by a sign-out on its own device.
  if (typeof decoded.sid !== 'string' || decoded.sid === '') return null;
  if (!isSessionLive(decoded.sid)) return null;

  return { user, decoded };
}

export function requireAuth(
  req: Request
): { user: MockUser; decoded: DecodedToken } | { error: number } {
  const result = authenticateRequest(req);
  if (!result) return { error: 401 };
  return result;
}

export type GuardError = {
  error: number;
  message?: string;
  errorKey?: string;
};

/**
 * Mirrors the three layers that `@Authorize` composes on the server:
 * JwtAuthGuard, then MfaRequiredGuard, then PermissionsGuard. The last layer is
 * a type-level CASL check, so a route that also needs the record itself runs a
 * second check inside the handler, exactly as the server controllers do.
 */
export function requirePermission(
  action: Actions,
  subject: SubjectNames
): (req: Request) => { user: MockUser; decoded: DecodedToken } | GuardError {
  return (req) => {
    const result = requireAuth(req);
    if ('error' in result) return result;

    // Mirrors MfaRequiredGuard, which travels with @Authorize on the server.
    if (mustEnrolMfa(result.user)) {
      return {
        error: 403,
        message:
          'Two-factor authentication must be turned on before this account can use the administration surface',
        errorKey: ErrorKeys.AUTH.MFA_ENROLMENT_REQUIRED
      };
    }

    if (!buildAbilityForUser(result.user).can(action, subject)) {
      return { error: 403, message: 'Insufficient permissions' };
    }

    return result;
  };
}

/** Express middleware — requires authenticated user, attaches req.user */
export function authGuard(req: Request, res: Response, next: NextFunction) {
  const result = requireAuth(req);
  if ('error' in result) {
    res
      .status(result.error)
      .json({ message: 'Unauthorized', statusCode: result.error });
    return;
  }
  (req as AuthenticatedRequest).user = result.user;
  next();
}

/** Express middleware - requires one CASL permission, attaches req.user */
export function permissionGuard(action: Actions, subject: SubjectNames) {
  const check = requirePermission(action, subject);
  return (req: Request, res: Response, next: NextFunction) => {
    const result = check(req);
    if ('error' in result) {
      const msg =
        result.message ?? (result.error === 403 ? 'Forbidden' : 'Unauthorized');
      res.status(result.error).json({
        message: msg,
        statusCode: result.error,
        ...(result.errorKey ? { errorKey: result.errorKey } : {})
      });
      return;
    }
    (req as AuthenticatedRequest).user = result.user;
    next();
  };
}

/**
 * Mirrors the controller-level `assertCan` on the server. The route guard is a
 * type-level check that ignores conditions, so a conditional grant has to be
 * re-evaluated against the record the caller submits. Answers 403 and returns
 * false when the caller may not act on that record.
 */
export function assertInstancePermission(
  req: Request,
  res: Response,
  action: Actions,
  subjectName: SubjectNames,
  record: object
): boolean {
  const { user } = req as AuthenticatedRequest;
  if (buildAbilityForUser(user).can(action, caslSubject(subjectName, record))) {
    return true;
  }
  res
    .status(403)
    .json({ message: 'Insufficient permissions', statusCode: 403 });
  return false;
}

/**
 * Concurrent-session cap, applied wherever a session is created. The oldest
 * refresh tokens go first, matching the real server's SessionLimitService.
 */
export function pruneOldestUserTokens(
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
