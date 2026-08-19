import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { CaptchaConfigResponse } from '@app/shared/types';
import { firstValueFrom } from 'rxjs';
import { AuthApiEnum } from '../constants/auth-api.const';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';

const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';

type TurnstileRenderOptions = {
  sitekey: string;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'flexible' | 'compact';
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
};

type TurnstileApi = {
  render(
    container: HTMLElement | string,
    options: TurnstileRenderOptions
  ): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
  getResponse(widgetId?: string): string | undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- module augmentation requires `interface`
  interface Window {
    turnstile?: TurnstileApi;
  }
}

@Injectable({ providedIn: 'root' })
export class CaptchaService {
  readonly #http = inject(HttpClient);
  readonly #document = inject(DOCUMENT);

  readonly #config = signal<CaptchaConfigResponse | null>(null);
  readonly config = this.#config.asReadonly();

  #configRequest: Promise<CaptchaConfigResponse> | null = null;
  #scriptLoad: Promise<TurnstileApi> | null = null;

  /**
   * Fetches the public captcha configuration once per session. Subsequent
   * calls return the cached value. A failure is never cached: caching one
   * would latch the captcha off for the rest of the session.
   */
  loadConfig(): Promise<CaptchaConfigResponse> {
    const cached = this.#config();
    if (cached) return Promise.resolve(cached);
    if (this.#configRequest) return this.#configRequest;

    const ctx = new HttpContext().set(
      DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN,
      true
    );
    const request = firstValueFrom(
      this.#http.get<CaptchaConfigResponse>(AuthApiEnum.CaptchaConfig, {
        context: ctx
      })
    )
      .then((cfg) => {
        this.#config.set(cfg);
        return cfg;
      })
      .catch((err: unknown) => {
        this.#configRequest = null;
        // Re-throw so subscribers can react if they care; default-handler
        // suppression is set on the request context above.
        throw err;
      });
    this.#configRequest = request;
    return request;
  }

  /**
   * Lazily injects the Turnstile script and resolves with the global
   * `turnstile` API. Idempotent while the load is in flight or has succeeded;
   * a failed load is discarded so the next call starts a fresh attempt.
   */
  loadScript(): Promise<TurnstileApi> {
    if (this.#scriptLoad) return this.#scriptLoad;

    const load = this.#requestScript().catch((err: unknown) => {
      this.#scriptLoad = null;
      throw err;
    });
    this.#scriptLoad = load;
    return load;
  }

  #requestScript(): Promise<TurnstileApi> {
    return new Promise<TurnstileApi>((resolve, reject) => {
      const loaded = this.#document.defaultView?.turnstile;
      if (loaded) {
        resolve(loaded);
        return;
      }

      // A tag left behind by a failed attempt never fires another event, so it
      // is dropped on failure and the next attempt appends a fresh one.
      const attach = (script: HTMLScriptElement) => {
        const fail = (message: string) => {
          script.remove();
          reject(new Error(message));
        };
        script.addEventListener(
          'load',
          () => {
            const api = this.#document.defaultView?.turnstile;
            if (api) resolve(api);
            else fail('Turnstile script loaded without exposing API');
          },
          { once: true }
        );
        script.addEventListener(
          'error',
          () => fail('Failed to load Turnstile script'),
          { once: true }
        );
      };

      const existing = this.#document.getElementById(
        TURNSTILE_SCRIPT_ID
      ) as HTMLScriptElement | null;
      if (existing) {
        attach(existing);
        return;
      }

      const script = this.#document.createElement('script');
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      attach(script);
      this.#document.head.appendChild(script);
    });
  }
}
