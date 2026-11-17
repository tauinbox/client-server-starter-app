/**
 * Matches MAX_EMAIL_LENGTH, the cap on User.email. The audit columns are
 * unbounded varchar, so an over-long actor email or request id would be stored
 * as sent. Every string field is capped at write time, not at the call sites,
 * because some of them carry values the caller never validated (a login email
 * reaches the row without a DTO, and req.ip is resolved from a proxy header).
 */
export const AUDIT_FIELD_MAX_LENGTH = 255;

export function capAuditField(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  return value.slice(0, AUDIT_FIELD_MAX_LENGTH);
}
