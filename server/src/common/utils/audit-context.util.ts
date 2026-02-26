import type { IncomingHttpHeaders } from 'http';
import { AuditContext } from '../../modules/audit/audit.service';

interface AuditRequest {
  ip?: string;
  headers: IncomingHttpHeaders;
}

export function extractAuditContext(req: AuditRequest): AuditContext {
  return {
    ip: req.ip,
    requestId: (req.headers['x-request-id'] as string) ?? undefined
  };
}
