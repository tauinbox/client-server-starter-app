import { v4 as uuidv4 } from 'uuid';
import {
  MFA_PENDING_TOKEN_EXPIRY_SECONDS,
  TOKEN_PURPOSE
} from '@app/shared/constants';
import type { MockUser } from './types';

function base64url(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function generateAccessToken(
  user: MockUser,
  sessionId: string,
  expiresInSeconds = 3600
): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({
    sub: user.id,
    email: user.email,
    roles: user.roles,
    purpose: TOKEN_PURPOSE.ACCESS,
    sid: sessionId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  });
  return `${header}.${payload}.mock-signature`;
}

/**
 * What a correct password buys on an account that carries a second factor. It
 * carries the mfa-pending purpose, so validateToken below refuses it as a
 * bearer credential exactly as JwtStrategy does.
 */
export function generateMfaPendingToken(
  user: MockUser,
  expiresInSeconds = MFA_PENDING_TOKEN_EXPIRY_SECONDS
): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({
    sub: user.id,
    email: user.email,
    purpose: TOKEN_PURPOSE.MFA_PENDING,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  });
  return `${header}.${payload}.mock-signature`;
}

export function generateRefreshToken(): string {
  return uuidv4();
}

/**
 * The caller mints the session id and binds it to the refresh token through
 * `registerSession`. Rotation passes the id of the session it replaces a token
 * in, so the access tokens issued earlier in that session stay usable.
 */
export function generateTokens(
  user: MockUser,
  sessionId: string,
  expiresInSeconds = 3600
): { access_token: string; refresh_token: string; expires_in: number } {
  return {
    access_token: generateAccessToken(user, sessionId, expiresInSeconds),
    refresh_token: generateRefreshToken(),
    expires_in: expiresInSeconds
  };
}

export function generateSessionId(): string {
  return uuidv4();
}

export interface DecodedToken {
  sub: string;
  email: string;
  roles: string[];
  purpose?: string;
  sid?: string;
  iat: number;
  exp: number;
}

export function decodeToken(token: string): DecodedToken | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64').toString('utf-8')
    );
    return payload as DecodedToken;
  } catch {
    return null;
  }
}

export function validateToken(token: string): DecodedToken | null {
  const decoded = decodeToken(token);
  if (!decoded) return null;

  // Fail closed on a missing/invalid iat, matching the real server:
  // the revocation check compares against iat and must not be skippable
  if (typeof decoded.iat !== 'number' || !Number.isFinite(decoded.iat)) {
    return null;
  }

  // Matching the real server: only an access-purpose token authenticates, and a
  // missing subject fails closed rather than resolving to an arbitrary user
  if (decoded.purpose !== TOKEN_PURPOSE.ACCESS) {
    return null;
  }
  if (typeof decoded.sub !== 'string' || decoded.sub === '') {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (decoded.exp < now) return null;

  return decoded;
}
