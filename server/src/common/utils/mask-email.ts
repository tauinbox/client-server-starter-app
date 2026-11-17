/**
 * Masks an email address for display in security notifications sent to the
 * OLD address during a self-service email change. Reveals only the first and
 * last character of the local-part plus the full domain.
 *
 * Examples:
 *   maskEmail('alice@example.com')   -> 'a***e@example.com'
 *   maskEmail('al@example.com')      -> 'a***l@example.com'
 *   maskEmail('a@example.com')       -> 'a***@example.com'
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');

  if (atIndex <= 0) return email;

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);

  if (local.length <= 1) return `${local[0]}***${domain}`;

  return `${local[0]}***${local.slice(-1)}${domain}`;
}
