import { AuditContext } from '../../modules/audit/audit.service';

/**
 * Only the sanitised id that RequestIdMiddleware writes on the request is read.
 * The raw X-Request-Id header is attacker-controlled and must never reach a row.
 */
interface AuditRequest {
  ip?: string;
  requestId?: string;
}

export function extractAuditContext(req: AuditRequest): AuditContext {
  return {
    ip: req.ip,
    requestId: req.requestId
  };
}
