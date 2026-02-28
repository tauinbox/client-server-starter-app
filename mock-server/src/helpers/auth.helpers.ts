import type { Request, Response, NextFunction } from 'express';
import { validateToken, type DecodedToken } from '../jwt.utils';
import { findUserById } from '../state';
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

  return { user, decoded };
}

export function requireAuth(
  req: Request
): { user: MockUser; decoded: DecodedToken } | { error: number } {
  const result = authenticateRequest(req);
  if (!result) return { error: 401 };
  return result;
}

export function requireAdmin(
  req: Request
): { user: MockUser; decoded: DecodedToken } | { error: number } {
  const result = requireAuth(req);
  if ('error' in result) return result;
  if (!result.user.roles?.includes('admin')) return { error: 403 };
  return result;
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

/** Express middleware — requires admin user, attaches req.user */
export function adminGuard(req: Request, res: Response, next: NextFunction) {
  const result = requireAdmin(req);
  if ('error' in result) {
    const msg = result.error === 403 ? 'Forbidden' : 'Unauthorized';
    res.status(result.error).json({ message: msg, statusCode: result.error });
    return;
  }
  (req as AuthenticatedRequest).user = result.user;
  next();
}
