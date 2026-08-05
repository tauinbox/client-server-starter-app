import { createHash } from 'crypto';

/**
 * Derives a stable UUID from a readable slug. The real server's primary keys
 * are `uuid` columns guarded by `ParseUUIDPipe`, so mock fixtures have to be
 * UUID-shaped to reproduce its 400-on-malformed-id behaviour; hashing a slug
 * keeps the fixtures self-describing and reproducible across restarts instead
 * of scattering opaque literals through seeds and specs.
 */
export function mockId(slug: string): string {
  const hex = createHash('sha256').update(slug).digest('hex');
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, '0');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32)
  ].join('-');
}

/**
 * Byte-for-byte the `all` entry of `ParseUUIDPipe.uuidRegExps`. None of the
 * server's `@Param('...', ParseUUIDPipe)` sites passes a `version`, so the pipe
 * falls back to `all`, which does not constrain the version or variant nibbles.
 * A stricter pattern here would reject ids the server accepts.
 */
export const UUID_PATTERN =
  /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
