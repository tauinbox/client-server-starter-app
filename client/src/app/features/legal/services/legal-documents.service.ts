import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { silentContext } from '@core/context-tokens/error-notifications';
import type {
  LegalDocumentContent,
  LegalDocumentRef
} from '../models/legal-document';

@Injectable({ providedIn: 'root' })
export class LegalDocumentsService {
  readonly #http = inject(HttpClient);

  getDocument({
    jurisdiction,
    kind,
    locale
  }: LegalDocumentRef): Observable<LegalDocumentContent> {
    return this.#http.get<LegalDocumentContent>(
      `assets/legal/${jurisdiction}/${kind}.${locale}.json`,
      { context: silentContext() }
    );
  }
}
