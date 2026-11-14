import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  LEGAL_DOCUMENTS,
  LEGAL_JURISDICTIONS,
  type LegalDocumentKind,
  type LegalJurisdiction
} from '@app/shared/constants';
import { LanguageService } from '@core/services/language.service';
import { LocalizedDatePipe } from '@shared/pipes/localized-date.pipe';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { LegalDocumentsService } from '../../services/legal-documents.service';
import { LegalJurisdictionService } from '../../services/legal-jurisdiction.service';
import { LegalLinksComponent } from '../legal-links/legal-links.component';

@Component({
  selector: 'nxs-legal-document',
  imports: [
    RouterLink,
    MatButton,
    MatProgressSpinner,
    TranslocoDirective,
    LocalizedDatePipe,
    LegalLinksComponent
  ],
  templateUrl: './legal-document.component.html',
  styleUrl: './legal-document.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LegalDocumentComponent {
  readonly #documents = inject(LegalDocumentsService);
  readonly #legal = inject(LegalJurisdictionService);
  readonly #language = inject(LanguageService).language;

  // Route parameters; the route guard admits known values only.
  readonly jurisdiction = input.required<LegalJurisdiction>();
  readonly kind = input.required<LegalDocumentKind>();

  protected readonly legalSegment = AppRouteSegmentEnum.Legal;

  protected readonly document = rxResource({
    params: () => ({
      jurisdiction: this.jurisdiction(),
      kind: this.kind(),
      locale: this.#language()
    }),
    stream: ({ params }) => this.#documents.getDocument(params)
  });

  protected readonly isDraft = computed(
    () => LEGAL_DOCUMENTS[this.jurisdiction()][this.kind()].status === 'draft'
  );

  /** The jurisdictions that show this kind of document. */
  protected readonly jurisdictions = computed(() =>
    LEGAL_JURISDICTIONS.filter((jurisdiction) =>
      this.#legal.isVisible(jurisdiction, this.kind())
    )
  );
}
