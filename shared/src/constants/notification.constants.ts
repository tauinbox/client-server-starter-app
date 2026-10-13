/**
 * The limit of open notification streams of one user. A browser opens one
 * stream for each tab, so the limit is the number of tabs that get real-time
 * events.
 */
export const MAX_SSE_STREAMS_PER_USER = 10;
