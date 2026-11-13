/**
 * How far past the clock of the server a usage `occurredAt` may be. It absorbs
 * clock skew between a producer and the server; a later timestamp is refused,
 * because the use cannot have happened yet.
 */
export const USAGE_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * The meter catalog: each meter key and the capability that it meters. A use
 * of a meter is free for a subscriber whose plan has that capability, and it
 * takes credits from everyone else. Usage under a key outside this catalog is
 * refused.
 */
export const METERS = {
  api_calls: 'api-access'
} as const satisfies Record<string, string>;

export type MeterKey = keyof typeof METERS;

export function isMeterKey(key: string): key is MeterKey {
  return Object.hasOwn(METERS, key);
}
