// The version column is a PostgreSQL `integer`; a larger value would fail the
// conditional UPDATE with an out-of-range error instead of a 400.
const MAX_VERSION = 2_147_483_647;

const VERSION_PATTERN = /^[1-9]\d*$/;

/**
 * Reads the expected row version from an `If-Match` header: a positive integer,
 * optionally in one pair of double quotes. The server and the mock map
 * `'missing'` to 428 and `'invalid'` to 400.
 */
export function parseIfMatchVersion(
  header: string | undefined
): number | 'missing' | 'invalid' {
  if (header === undefined || header === '') return 'missing';
  const quoted = /^"(.*)"$/.exec(header);
  const value = quoted ? quoted[1] : header;
  if (!VERSION_PATTERN.test(value)) return 'invalid';
  const version = Number(value);
  return version <= MAX_VERSION ? version : 'invalid';
}
