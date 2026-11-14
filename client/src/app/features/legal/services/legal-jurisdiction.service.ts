import { computed, inject, Injectable, InjectionToken } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import {
  LEGAL_DOCUMENT_KINDS,
  LEGAL_DOCUMENTS,
  LEGAL_JURISDICTIONS,
  legalJurisdictionForProvider,
  type LegalDocumentKind,
  type LegalJurisdiction
} from '@app/shared/constants';
import type { BillingRegionResponse } from '@app/shared/types';
import { environment } from '@environments/environment';
import { LanguageService } from '@core/services/language.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { BillingService } from '@features/billing/services/billing.service';
import { resolveDisplayProvider } from '@features/billing/utils/billing-format';

/** A draft is on show outside a production build only, for the review. */
export const LEGAL_DRAFTS_VISIBLE = new InjectionToken<boolean>(
  'LEGAL_DRAFTS_VISIBLE',
  { providedIn: 'root', factory: () => !environment.production }
);

@Injectable({ providedIn: 'root' })
export class LegalJurisdictionService {
  readonly #draftsVisible = inject(LEGAL_DRAFTS_VISIBLE);
  readonly #authStore = inject(AuthStore);
  readonly #billing = inject(BillingService);
  readonly #language = inject(LanguageService).language;

  readonly hasVisibleDocuments = LEGAL_JURISDICTIONS.some(
    (jurisdiction) => this.visibleKinds(jurisdiction).length > 0
  );

  // No request while every document is hidden. A failed request leaves the
  // locale as the source, as for an anonymous visitor.
  readonly #region = rxResource<BillingRegionResponse | null, true | undefined>(
    {
      params: () =>
        this.hasVisibleDocuments && this.#authStore.isAuthenticated()
          ? true
          : undefined,
      stream: () => this.#billing.getRegion().pipe(catchError(() => of(null)))
    }
  );

  /**
   * A signed-in user follows the billing region; an anonymous visitor follows
   * the UI language.
   */
  readonly jurisdiction = computed<LegalJurisdiction>(() =>
    legalJurisdictionForProvider(
      resolveDisplayProvider(
        this.#region.value()?.effectiveProvider ?? null,
        this.#language()
      )
    )
  );

  isVisible(jurisdiction: LegalJurisdiction, kind: LegalDocumentKind): boolean {
    return (
      this.#draftsVisible ||
      LEGAL_DOCUMENTS[jurisdiction][kind].status === 'published'
    );
  }

  visibleKinds(jurisdiction: LegalJurisdiction): LegalDocumentKind[] {
    return LEGAL_DOCUMENT_KINDS.filter((kind) =>
      this.isVisible(jurisdiction, kind)
    );
  }

  /** The billing store reports each region that it loads or changes. */
  setBillingRegion(region: BillingRegionResponse): void {
    if (this.#authStore.isAuthenticated()) this.#region.set(region);
  }
}
