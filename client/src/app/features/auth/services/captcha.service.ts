import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CaptchaConfigResponse } from '@app/shared/types';
import type { DataRegion } from '@app/shared/constants';
import { firstValueFrom } from 'rxjs';
import { AuthApiEnum } from '../constants/auth-api.const';
import { AuthStore } from '../store/auth.store';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';
import { API_REGION_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/api-region';
import { loadExternalScript } from '@shared/utils/external-script.utils';

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

  readonly #authStore = inject(AuthStore);

  readonly #configRequests = new Map<
    DataRegion,
    Promise<CaptchaConfigResponse>
  >();

  #scriptLoad: Promise<TurnstileApi> | null = null;

  /**
   * Fetches the public captcha configuration of the pool of `region`, the
   * region of the session by default, once for each region: each pool checks
   * the tokens of its own keys. A failure is never cached: caching one would
   * latch the captcha off for the rest of the session.
   */
  loadConfig(
    region: DataRegion = this.#authStore.region()
  ): Promise<CaptchaConfigResponse> {
    const cached = this.#configRequests.get(region);

    if (cached) return cached;

    const ctx = new HttpContext()
      .set(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN, true)
      .set(API_REGION_HTTP_CONTEXT_TOKEN, region);
    const request = firstValueFrom(
      this.#http.get<CaptchaConfigResponse>(AuthApiEnum.CaptchaConfig, {
        context: ctx
      })
    ).catch((err: unknown) => {
      this.#configRequests.delete(region);
      // Re-throw so subscribers can react if they care; default-handler
      // suppression is set on the request context above.
      throw err;
    });

    this.#configRequests.set(region, request);

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
    return loadExternalScript(this.#document, {
      name: 'Turnstile',
      id: TURNSTILE_SCRIPT_ID,
      src: TURNSTILE_SCRIPT_URL,
      api: () => this.#document.defaultView?.turnstile
    });
  }
}
