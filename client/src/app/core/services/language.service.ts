import { effect, inject, Injectable, signal } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import { DOCUMENT } from '@angular/common';
import { TranslocoService } from '@jsverse/transloco';
import { catchError, filter, firstValueFrom, forkJoin, of } from 'rxjs';
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

  readonly #loadedScopes = new Set<string>();
  #requestedLang: AppLanguage | null = null;

  constructor() {
    effect(() => {
      const lang = this.#langSignal();

      this.#document.documentElement.lang = lang;
    });

    this.#translocoService.events$
      .pipe(filter((event) => event.type === 'translationLoadSuccess'))
      .subscribe(({ payload: { scope } }) => {
        if (scope) this.#loadedScopes.add(scope);
      });

    this.#translocoService.setActiveLang(this.#langSignal());
    this.#registerLocale(this.#langSignal());
  }

  async setLanguage(lang: AppLanguage): Promise<void> {
    this.#requestedLang = lang;
    await this.#preload(lang);

    if (this.#requestedLang !== lang) return;

    this.#langSignal.set(lang);
    this.#storage.setItem(LANGUAGE_KEY, lang);
    this.#translocoService.setActiveLang(lang);
    await this.#registerLocale(lang);
  }

  /**
   * Loads the language and each scope loaded so far before the switch.
   * A shared component translates the scoped keys of its page but loads only
   * the root file, and Transloco does not render it again when the scope file
   * arrives later.
   */
  async #preload(lang: AppLanguage): Promise<void> {
    const paths = [
      lang,
      ...[...this.#loadedScopes].map((scope) => `${scope}/${lang}`)
    ];

    await firstValueFrom(
      forkJoin(
        paths.map((path) =>
          this.#translocoService.load(path).pipe(catchError(() => of(null)))
        )
      )
    );
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
