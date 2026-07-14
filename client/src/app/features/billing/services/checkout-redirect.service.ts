import { DOCUMENT, inject, Injectable } from '@angular/core';
import { NotifyService } from '@core/services/notify.service';

/**
 * A checkout session URL is provider-supplied data: only follow it when it
 * parses and is either https or same-origin (relative URLs resolve against
 * the app origin). Anything else - javascript:, data:, cross-origin http -
 * must never reach location.href.
 */
export function isSafeCheckoutUrl(url: string, baseOrigin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, baseOrigin);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' || parsed.origin === baseOrigin;
}

/** Single owner of hosted-checkout navigation for all billing call sites. */
@Injectable({ providedIn: 'root' })
export class CheckoutRedirectService {
  readonly #window = inject(DOCUMENT).defaultView;
  readonly #notify = inject(NotifyService);

  redirect(url: string): void {
    const win = this.#window;
    if (!win) return;
    if (!isSafeCheckoutUrl(url, win.location.origin)) {
      this.#notify.error('billing.errors.unsafeRedirect');
      return;
    }
    win.location.href = url;
  }
}
