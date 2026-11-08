import { pushToAll } from '../sse-hub';

/** An event that no SSE test of the mock asserts. */
export const SSE_SENTINEL = { type: 'entitlements_updated' } as const;

const SENTINEL_FRAME = `data: ${JSON.stringify(SSE_SENTINEL)}`;

/**
 * Pushes the sentinel to every stream and resolves once each body holds it.
 * The mock writes a push before it answers the request that caused it, and
 * one stream delivers its frames in order, so every frame of the requests
 * before the call has arrived by then. A test then asserts that a frame did
 * not come, in place of a fixed pause. The deadline only stops a hang.
 */
export async function untilSentinel(bodies: (() => string)[]): Promise<void> {
  pushToAll(SSE_SENTINEL);
  const deadline = Date.now() + 5000;

  while (!bodies.every((body) => body().includes(SENTINEL_FRAME))) {
    if (Date.now() > deadline) {
      throw new Error('The sentinel did not reach every stream');
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** True for a parsed frame that is not the sentinel. */
export function isNotSentinel({ type }: { type: string }): boolean {
  return type !== SSE_SENTINEL.type;
}
