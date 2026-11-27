import { DOCUMENT, inject, Injectable } from '@angular/core';
import { isDataRegion, type DataRegion } from '@app/shared/constants';
import { SessionStorageService } from '@core/services/session-storage.service';

const OAUTH_INTENT_KEY = 'oauth_intent';

/**
 * Where the callback goes after the sign-in, and the region whose API host
 * started the round trip: the provider returns to that host, which keeps the
 * result in a host-only cookie, so the callback must exchange it there.
 */
export type OAuthIntent = { returnUrl: string; region: DataRegion };

function isOAuthIntent(value: unknown): value is OAuthIntent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'returnUrl' in value &&
    typeof value.returnUrl === 'string' &&
    'region' in value &&
    isDataRegion(value.region)
  );
}

/**
 * Proof that this tab started the provider round trip that ends on the OAuth
 * callback. Any page can navigate a browser to the provider start route, and a
 * provider that already has consent returns without a screen, so the callback
 * must not finish a sign-in that this tab did not ask for.
 *
 * The provider returns to the callback with a full page load, so the proof is
 * good for exactly one page load: it is taken out of storage at bootstrap and
 * only the callback can read it. A round trip that ends anywhere else (a failed
 * sign-in on /login, a link on /profile, a Back to the app) drops it.
 */
@Injectable({ providedIn: 'root' })
export class OAuthIntentService {
  readonly #sessionStorage = inject(SessionStorageService);
  #intent: OAuthIntent | null;

  constructor() {
    this.#intent = this.#sessionStorage.getItem<OAuthIntent>(
      OAUTH_INTENT_KEY,
      isOAuthIntent
    );
    this.#sessionStorage.removeItem(OAUTH_INTENT_KEY);

    // A Back from the provider restores this page from the back/forward cache
    // with no bootstrap, so the proof written before leaving is still stored.
    inject(DOCUMENT).defaultView?.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        this.#sessionStorage.removeItem(OAUTH_INTENT_KEY);
      }
    });
  }

  /** Call just before the browser leaves for the provider. */
  start(intent: OAuthIntent): void {
    this.#sessionStorage.setItem(OAUTH_INTENT_KEY, intent);
  }

  /** The intent when this tab started the round trip, else null. Once only. */
  take(): OAuthIntent | null {
    const intent = this.#intent;

    this.#intent = null;

    return intent;
  }
}
