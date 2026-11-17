import * as ipaddr from 'ipaddr.js';

/**
 * Mirrors `normalizeIpAddress` of the server: an invalid address is null, an
 * IPv4-mapped IPv6 address is unwrapped, and the result is in canonical form.
 */
export function normalizeIpAddress(ip: string | undefined): string | null {
  if (!ip || !ipaddr.isValid(ip)) return null;

  return ipaddr.process(ip).toString();
}
