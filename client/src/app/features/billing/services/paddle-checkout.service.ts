import { DOCUMENT, inject, Injectable } from '@angular/core';
import type { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import type { PaddleClientConfigResponse } from '@app/shared/types';
import { loadExternalScript } from '@shared/utils/external-script.utils';
import { BillingService } from './billing.service';

/**
 * The query parameter that Paddle adds to the checkout URL of a transaction
 * (the `checkout.url` of the transaction, or the default payment link).
 */
export const PADDLE_TRANSACTION_PARAM = '_ptxn';

export type PaddleCheckoutResult = 'completed' | 'closed' | 'unavailable';

/** The Paddle transaction id in the URL of the page, if any. */
export function paddleTransactionId(route: ActivatedRoute): string | null {
  return route.snapshot.queryParamMap.get(PADDLE_TRANSACTION_PARAM);
}

/** Removes the transaction id, so that a reload does not open it again. */
export function dropPaddleTransactionId(router: Router): void {
  void router.navigate([], {
    queryParams: { [PADDLE_TRANSACTION_PARAM]: null },
    queryParamsHandling: 'merge',
    replaceUrl: true
  });
}

const PADDLE_SCRIPT_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js';
const PADDLE_SCRIPT_ID = 'paddle-js-script';
const TRANSACTION_ID = /^txn_[a-z0-9]+$/;

type PaddleEvent = { name?: string };

/** The part of the Paddle.js v2 API that the app uses. */
type PaddleApi = {
  Environment: {
    set(environment: PaddleClientConfigResponse['environment']): void;
  };
  Initialize(options: {
    token: string;
    eventCallback: (event: PaddleEvent) => void;
  }): void;
  Checkout: {
    open(options: {
      transactionId: string;
      settings: { displayMode: 'overlay'; locale: string };
    }): void;
    close(): void;
  };
};

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- module augmentation requires `interface`
  interface Window {
    Paddle?: PaddleApi;
  }
}

/**
 * Opens the Paddle checkout of a server-created transaction in an overlay.
 * Paddle.js loads on the first use only, from the Paddle CDN, with the public
 * client-side token that the server advertises.
 */
@Injectable({ providedIn: 'root' })
export class PaddleCheckoutService {
  readonly #billing = inject(BillingService);
  readonly #transloco = inject(TranslocoService);
  readonly #document = inject(DOCUMENT);

  #paddle: Promise<PaddleApi | null> | null = null;
  #settle: ((result: PaddleCheckoutResult) => void) | null = null;

  /**
   * Resolves when the buyer completes the payment or closes the overlay, or
   * at once with `unavailable` when Paddle.js cannot open the transaction.
   */
  async open(transactionId: string): Promise<PaddleCheckoutResult> {
    if (!TRANSACTION_ID.test(transactionId)) return 'unavailable';
    this.#paddle ??= this.#initialize();
    const paddle = await this.#paddle;
    if (!paddle) {
      // A refused config request or a blocked CDN script: the next open tries
      // again instead of keeping the failure.
      this.#paddle = null;
      return 'unavailable';
    }
    this.#finish('closed');
    return new Promise<PaddleCheckoutResult>((resolve) => {
      this.#settle = resolve;
      paddle.Checkout.open({
        transactionId,
        settings: {
          displayMode: 'overlay',
          locale: this.#transloco.getActiveLang()
        }
      });
    });
  }

  async #initialize(): Promise<PaddleApi | null> {
    try {
      const config = await firstValueFrom(this.#billing.getPaddleConfig());
      if (!config.clientToken) return null;
      const paddle = await loadExternalScript(this.#document, {
        name: 'Paddle.js',
        id: PADDLE_SCRIPT_ID,
        src: PADDLE_SCRIPT_URL,
        api: () => this.#document.defaultView?.Paddle
      });
      paddle.Environment.set(config.environment);
      paddle.Initialize({
        token: config.clientToken,
        eventCallback: (event) => this.#onEvent(paddle, event)
      });
      return paddle;
    } catch {
      return null;
    }
  }

  #onEvent(paddle: PaddleApi, event: PaddleEvent): void {
    if (event.name === 'checkout.completed') {
      this.#finish('completed');
      // The overlay shows its own receipt; the app shows the result instead.
      paddle.Checkout.close();
    } else if (event.name === 'checkout.closed') {
      this.#finish('closed');
    }
  }

  #finish(result: PaddleCheckoutResult): void {
    const settle = this.#settle;
    this.#settle = null;
    settle?.(result);
  }
}
