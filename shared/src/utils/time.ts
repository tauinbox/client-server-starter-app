/**
 * Single import site for the Temporal API.
 *
 * Temporal is TC39 Stage 3 and not yet in the Node runtime (or browsers), so a
 * polyfill is required today. Every module that needs Temporal imports it from
 * here, never from the polyfill package directly. When native Temporal ships,
 * switching is a one-line change in this file.
 *
 * The polyfill version is pinned exactly in the consuming workspace's
 * package.json (no caret) because the spec is not final and 0.x may break.
 */
export { Temporal } from 'temporal-polyfill';
