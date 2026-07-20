import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger
} from '@nestjs/common';
import type { Request } from 'express';
import * as ipaddr from 'ipaddr.js';

// Covers every legitimate scrape path (Prometheus on the docker bridge,
// host-local checks). req.ip honors `trust proxy` (TRUSTED_PROXIES), so an
// untrusted peer cannot spoof an internal address via X-Forwarded-For.
const INTERNAL_RANGES = new Set(['loopback', 'private', 'uniqueLocal']);

@Injectable()
export class InternalNetworkGuard implements CanActivate {
  private readonly logger = new Logger(InternalNetworkGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.ip && isInternal(req.ip)) {
      return true;
    }
    this.logger.warn(
      `Rejected request from non-internal IP ${req.ip ?? '<unknown>'} on ${req.method} ${req.originalUrl}`
    );
    throw new ForbiddenException();
  }
}

function isInternal(ip: string): boolean {
  if (!ipaddr.isValid(ip)) {
    return false;
  }
  // process() unwraps IPv4-mapped IPv6 (::ffff:a.b.c.d)
  return INTERNAL_RANGES.has(ipaddr.process(ip).range());
}
