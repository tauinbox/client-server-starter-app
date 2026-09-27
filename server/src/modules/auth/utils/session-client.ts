import * as ipaddr from 'ipaddr.js';
import { normalizeUserAgent } from '../../../common/utils/user-agent.util';

/** What the session list records about the device that holds a session. */
export interface SessionClient {
  userAgent: string | null;
  ipAddress: string | null;
}

interface ClientRequest {
  ip?: string;
  headers: { 'user-agent'?: string | string[] };
}

/**
 * `req.ip` already honours the `trust proxy` setting. An IPv4-mapped IPv6
 * address is unwrapped, so one device does not show two forms of one address.
 */
export function normalizeIpAddress(ip: string | undefined): string | null {
  if (!ip || !ipaddr.isValid(ip)) return null;
  return ipaddr.process(ip).toString();
}

export function sessionClientOf(req: ClientRequest): SessionClient {
  return {
    userAgent: normalizeUserAgent(req.headers['user-agent']),
    ipAddress: normalizeIpAddress(req.ip)
  };
}
