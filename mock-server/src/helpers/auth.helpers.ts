import type { Request } from 'express';
import { validateToken, type DecodedToken } from '../jwt.utils';
import { findUserById } from '../state';
import type { MockUser } from '../types';

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
  if (!result.user.isAdmin) return { error: 403 };
  return result;
}
