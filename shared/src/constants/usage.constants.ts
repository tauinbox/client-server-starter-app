/**
 * How far past the clock of the server a usage `occurredAt` may be. It absorbs
 * clock skew between a producer and the server; a later timestamp is refused,
 * because it would be rated in a later period than the one it was sent in.
 */
export const USAGE_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
