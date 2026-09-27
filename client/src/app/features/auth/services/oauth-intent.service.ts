import { DOCUMENT, inject, Injectable } from '@angular/core';
import { SessionStorageService } from '@core/services/session-storage.service';

const OAUTH_RETURN_URL_KEY = 'oauth_return_url';

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
  #returnUrl: string | null;

  constructor() {
    this.#returnUrl = this.#sessionStorage.getItem<string>(
      OAUTH_RETURN_URL_KEY,
      (value): value is string => typeof value === 'string'
    );
    this.#sessionStorage.removeItem(OAUTH_RETURN_URL_KEY);

    // A Back from the provider restores this page from the back/forward cache
    // with no bootstrap, so the proof written before leaving is still stored.
    inject(DOCUMENT).defaultView?.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        this.#sessionStorage.removeItem(OAUTH_RETURN_URL_KEY);
      }
    });
  }

  /** Call just before the browser leaves for the provider. */
  start(returnUrl: string): void {
    this.#sessionStorage.setItem(OAUTH_RETURN_URL_KEY, returnUrl);
  }

  /** The return URL when this tab started the round trip, else null. Once only. */
  take(): string | null {
    const returnUrl = this.#returnUrl;
    this.#returnUrl = null;
    return returnUrl;
  }
}
