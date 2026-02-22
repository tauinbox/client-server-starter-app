import { v4 as uuidv4 } from 'uuid';
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
  expiresInSeconds = 3600
): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({
    sub: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    roles: user.roles,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  });
  return `${header}.${payload}.mock-signature`;
}

export function generateRefreshToken(): string {
  return uuidv4();
}

export function generateTokens(
  user: MockUser,
  expiresInSeconds = 3600
): { access_token: string; refresh_token: string; expires_in: number } {
  return {
    access_token: generateAccessToken(user, expiresInSeconds),
    refresh_token: generateRefreshToken(),
    expires_in: expiresInSeconds
  };
}

export interface DecodedToken {
  sub: string;
  email: string;
  isAdmin: boolean;
  roles: string[];
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

  const now = Math.floor(Date.now() / 1000);
  if (decoded.exp < now) return null;

  return decoded;
}
