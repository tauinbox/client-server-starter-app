import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import * as ipaddr from 'ipaddr.js';

type AllowedRange = [ipaddr.IPv4 | ipaddr.IPv6, number];

/**
 * Source-IP allowlist for the provider webhook receivers.
 *
 * YooKassa notifications are unsigned by design - authenticity comes from an
 * outbound re-fetch of the payment - so without an IP check any internet host
 * can force outbound YooKassa API calls (and the receivers skip the global
 * throttle). Both providers publish fixed egress ranges and recommend
 * allowlisting them; for Paddle (HMAC-verified) this is defense in depth.
 *
 * BILLING_WEBHOOK_IP_ALLOWLIST is a comma-separated list of IPs and CIDR
 * blocks (IPv6 supported). Empty or unset disables the check (local dev,
 * e2e). A malformed entry throws at bootstrap: failing the deploy loudly
 * beats silently letting everything through or dropping real webhooks.
 *
 * The client address is req.ip, which honors the `trust proxy` setting from
 * TRUSTED_PROXIES - an X-Forwarded-For header from an untrusted peer is
 * ignored, so the check cannot be spoofed by direct clients.
 */
@Injectable()
export class WebhookIpAllowlistGuard implements CanActivate {
  private readonly logger = new Logger(WebhookIpAllowlistGuard.name);
  private readonly allowed: AllowedRange[];

  constructor(config: ConfigService) {
    this.allowed = parseAllowlist(
      config.get<string>('BILLING_WEBHOOK_IP_ALLOWLIST')
    );
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.allowed.length === 0) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request>();
    if (req.ip && this.isAllowed(req.ip)) {
      return true;
    }
    this.logger.warn(
      `Rejected webhook from non-allowlisted IP ${req.ip ?? '<unknown>'} on ${req.method} ${req.originalUrl}`
    );
    throw new ForbiddenException();
  }

  private isAllowed(ip: string): boolean {
    if (!ipaddr.isValid(ip)) {
      return false;
    }
    // process() unwraps IPv4-mapped IPv6 (::ffff:a.b.c.d) so IPv4 entries
    // match regardless of the socket family the request arrived on.
    const addr = ipaddr.process(ip);
    return (
      ipaddr.subnetMatch(addr, { allowed: this.allowed }, 'denied') ===
      'allowed'
    );
  }
}

function parseAllowlist(raw: string | undefined): AllowedRange[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      try {
        if (entry.includes('/')) {
          return ipaddr.parseCIDR(entry);
        }
        const addr = ipaddr.parse(entry);
        return [addr, addr.kind() === 'ipv4' ? 32 : 128] as AllowedRange;
      } catch {
        throw new Error(
          `Invalid BILLING_WEBHOOK_IP_ALLOWLIST entry "${entry}": expected an IP address or CIDR block`
        );
      }
    });
}
