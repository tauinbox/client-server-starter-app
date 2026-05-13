/**
 * Escapes HTML special characters to prevent XSS when interpolating
 * user-controlled strings into HTML email bodies.
 *
 * Covers the five characters required by the OWASP HTML escaping rule:
 * &, <, >, ", and '.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Masks an email address for display in security notifications sent to the
 * OLD address during a self-service email change. Reveals only the first and
 * last character of the local-part plus the full domain.
 *
 * Examples:
 *   maskEmail('alice@example.com')   → 'a***e@example.com'
 *   maskEmail('al@example.com')      → 'a***@example.com'
 *   maskEmail('a@example.com')       → 'a***@example.com'
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return email;
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  if (local.length <= 1) return `${local[0]}***${domain}`;
  return `${local[0]}***${local[local.length - 1]}${domain}`;
}
