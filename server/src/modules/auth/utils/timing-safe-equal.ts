import { timingSafeEqual } from 'crypto';

/**
 * Compares without leaking how many leading characters matched. The length
 * check runs first because timingSafeEqual throws on differing lengths - the
 * state's length is fixed and not a secret, so revealing it costs nothing.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
