import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Translation, TranslocoLoader } from '@jsverse/transloco';

const SCOPE_PATH_MAP: Record<string, string> = {
  auth: 'app/features/auth/i18n',
  users: 'app/features/users/i18n',
  admin: 'app/features/admin/i18n'
};

@Injectable({ providedIn: 'root' })
export class TranslocoHttpLoader implements TranslocoLoader {
  readonly #http = inject(HttpClient);

  getTranslation(lang: string) {
    const [scope, language] = this.#parseLang(lang);

    if (scope && SCOPE_PATH_MAP[scope]) {
      return this.#http.get<Translation>(
        `${SCOPE_PATH_MAP[scope]}/${language}.json`
      );
    }

    return this.#http.get<Translation>(`assets/i18n/${lang}.json`);
  }

  #parseLang(lang: string): [string | null, string] {
    const idx = lang.indexOf('/');
    if (idx === -1) return [null, lang];
    return [lang.slice(0, idx), lang.slice(idx + 1)];
  }
}
