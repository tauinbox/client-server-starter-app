import { effect, inject, Injectable, signal } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import { DOCUMENT } from '@angular/common';
import { TranslocoService } from '@jsverse/transloco';
import { LocalStorageService } from './local-storage.service';

export type AppLanguage = 'en' | 'ru';

const LANGUAGE_KEY = 'preferred-language';
const SUPPORTED_LANGUAGES: AppLanguage[] = ['en', 'ru'];

@Injectable({
  providedIn: 'root'
})
export class LanguageService {
  readonly #storage = inject(LocalStorageService);
  readonly #translocoService = inject(TranslocoService);
  readonly #document = inject(DOCUMENT);

  readonly #langSignal = signal<AppLanguage>(this.#getInitialLang());
  readonly language = this.#langSignal.asReadonly();

  constructor() {
    effect(() => {
      const lang = this.#langSignal();
      this.#document.documentElement.lang = lang;
    });

    this.#translocoService.setActiveLang(this.#langSignal());
    this.#registerLocale(this.#langSignal());
  }

  async setLanguage(lang: AppLanguage): Promise<void> {
    this.#langSignal.set(lang);
    this.#storage.setItem(LANGUAGE_KEY, lang);
    this.#translocoService.setActiveLang(lang);
    await this.#registerLocale(lang);
  }

  #getInitialLang(): AppLanguage {
    const saved = this.#storage.getItem<AppLanguage>(LANGUAGE_KEY);
    if (saved && SUPPORTED_LANGUAGES.includes(saved)) {
      return saved;
    }

    const browserLang = navigator.language.split('-')[0].toLowerCase();
    if (SUPPORTED_LANGUAGES.includes(browserLang as AppLanguage)) {
      return browserLang as AppLanguage;
    }

    return 'en';
  }

  async #registerLocale(lang: AppLanguage): Promise<void> {
    if (lang === 'en') return;
    try {
      const localeModule = await import(
        /* @vite-ignore */ `@angular/common/locales/${lang}`
      );
      registerLocaleData(localeModule.default);
    } catch {
      // Unknown locale — fall back to built-in en-US
    }
  }
}
