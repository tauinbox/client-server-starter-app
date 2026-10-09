import { DOCUMENT, inject } from '@angular/core';
import type { NavigationError } from '@angular/router';
import { SessionStorageService } from '@core/services/session-storage.service';

const RELOAD_MARK_KEY = 'nxs.staleChunkReload';

/** A second failure on the same URL inside this window is a real fault. */
const RELOAD_LOOP_WINDOW_MS = 10_000;

// Chromium, Firefox and Safari word the failed `import()` differently.
const CHUNK_LOAD_FAILURE =
  /dynamically imported module|Importing a module script failed/i;

type ReloadMark = { url: string; at: number };

const isReloadMark = (value: unknown): value is ReloadMark =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ReloadMark).url === 'string' &&
  typeof (value as ReloadMark).at === 'number';

export function isChunkLoadFailure(error: unknown): boolean {
  return error instanceof Error && CHUNK_LOAD_FAILURE.test(error.message);
}

/**
 * A deploy replaces every lazy chunk, and the server keeps no old file. A page
 * that was open before the deploy then fails each navigation to a route it has
 * not loaded yet, and the router reports nothing to the user. A full load of
 * the target URL fetches the current build; the refresh cookie restores the
 * session.
 */
export function reloadOnStaleChunk(navigationError: NavigationError): void {
  if (!isChunkLoadFailure(navigationError.error)) return;

  const window = inject(DOCUMENT).defaultView;
  if (!window) return;

  // The router serializes an app path; anything else must not leave the origin.
  const url = navigationError.url;
  if (!url.startsWith('/') || url.startsWith('//')) return;

  const storage = inject(SessionStorageService);
  const mark = storage.getItem(RELOAD_MARK_KEY, isReloadMark);
  if (mark?.url === url && Date.now() - mark.at < RELOAD_LOOP_WINDOW_MS) {
    storage.removeItem(RELOAD_MARK_KEY);
    return;
  }

  storage.setItem<ReloadMark>(RELOAD_MARK_KEY, { url, at: Date.now() });
  window.location.assign(url);
}
