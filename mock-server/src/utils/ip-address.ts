import { isIP } from 'net';

/**
 * Mirrors `normalizeIpAddress` of the server: an invalid address is null, and
 * an IPv4-mapped IPv6 address is unwrapped.
 */
export function normalizeIpAddress(ip: string | undefined): string | null {
  if (!ip || isIP(ip) === 0) return null;
  return ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
}
