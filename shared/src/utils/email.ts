/**
 * Canonical email form used for every identity lookup and every write.
 *
 * Addresses are compared exactly (plain `varchar` equality in Postgres, plain
 * `===` in the mock), so a single canonical form is what keeps a login, an
 * OAuth assertion and a stored account referring to the same identity. This
 * lives in `shared/` so the server, the DTO transforms and the mock server all
 * apply the identical rule - a divergence here silently creates case-variant
 * duplicate accounts.
 *
 * Only the domain is case-insensitive per RFC 5321, but every mainstream
 * provider treats the local part case-insensitively too, and this project has
 * always stored registrations lowercased. Non-strings yield null so callers
 * decide explicitly how a malformed value is handled.
 */
export function normalizeEmail(value: unknown): string | null {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}
