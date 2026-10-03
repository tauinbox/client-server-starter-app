/**
 * Byte-for-byte the `all` entry of validator.js's uuid patterns, which is what
 * `@IsUUID()` validates a body field against. It is stricter than the pattern
 * `ParseUUIDPipe` applies to a route param: the version nibble must be 1-8 and
 * the variant nibble 8/9/a/b, so an id like
 * `11111111-1111-1111-1111-111111111111` passes as a param and fails in a body.
 */
export const BODY_UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
