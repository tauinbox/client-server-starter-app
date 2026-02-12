export function base64url(obj: Record<string, unknown>): string {
  return btoa(JSON.stringify(obj))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function createMockJwt(): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({ sub: '1', exp: 4102444800 });
  return `${header}.${payload}.mock-signature`;
}

export const createValidJwt = createMockJwt;

export function createExpiredJwt(): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  // exp = 1 hour ago
  const payload = base64url({
    sub: '1',
    exp: Math.floor(Date.now() / 1000) - 3600
  });
  return `${header}.${payload}.mock-signature`;
}
