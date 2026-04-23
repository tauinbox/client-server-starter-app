import type { NestExpressApplication } from '@nestjs/platform-express';

export type TrustProxyValue = boolean | number | string;

/**
 * Coerce a `TRUSTED_PROXIES` env string into an Express `trust proxy` value:
 * `true`/`false` → boolean, pure digits → hop count, everything else stays a
 * string (named group like `loopback` or a CIDR/IP list). Empty/undefined
 * leaves Express defaults untouched — `req.ip` then equals the socket peer.
 */
export function parseTrustedProxies(
  raw: string | undefined
): TrustProxyValue | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

export function applyTrustProxy(
  app: NestExpressApplication,
  raw: string | undefined
): TrustProxyValue | undefined {
  const value = parseTrustedProxies(raw);
  if (value === undefined) {
    return undefined;
  }
  app.set('trust proxy', value);
  return value;
}
