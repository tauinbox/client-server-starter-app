import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  LEGAL_DOCUMENT_KINDS,
  type LegalDocumentKind,
  type LegalJurisdiction
} from '@app/shared/constants';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { LegalJurisdictionService } from '../../services/legal-jurisdiction.service';

/**
 * Links to the legal documents of one jurisdiction. It renders nothing while
 * none of the requested documents is on show.
 */
@Component({
  selector: 'nxs-legal-links',
  imports: [RouterLink, TranslocoDirective],
  templateUrl: './legal-links.component.html',
  styleUrl: './legal-links.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LegalLinksComponent {
  readonly #legal = inject(LegalJurisdictionService);

  readonly kinds = input<readonly LegalDocumentKind[]>(LEGAL_DOCUMENT_KINDS);
  /** Defaults to the jurisdiction of the visitor. */
  readonly jurisdiction = input<LegalJurisdiction>();
  /** Translation key of the text before the links. */
  readonly intro = input<string>();

  protected readonly legalSegment = AppRouteSegmentEnum.Legal;

  protected readonly activeJurisdiction = computed(
    () => this.jurisdiction() ?? this.#legal.jurisdiction()
  );

  protected readonly links = computed(() => {
    const jurisdiction = this.activeJurisdiction();

    return this.kinds().filter((kind) =>
      this.#legal.isVisible(jurisdiction, kind)
    );
  });
}
