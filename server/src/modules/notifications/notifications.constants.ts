/** The interval of the stream heartbeat, which also checks the session. */
export const SSE_HEARTBEAT_INTERVAL_MS = Symbol('SSE_HEARTBEAT_INTERVAL_MS');

export const DEFAULT_SSE_HEARTBEAT_INTERVAL_MS = 30_000;
