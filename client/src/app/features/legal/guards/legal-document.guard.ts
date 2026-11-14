import { inject } from '@angular/core';
import type { CanMatchFn } from '@angular/router';
import {
  isLegalDocumentKind,
  isLegalJurisdiction
} from '@app/shared/constants';
import { LegalJurisdictionService } from '../services/legal-jurisdiction.service';

/**
 * Matches `legal/:jurisdiction/:kind` only for a known document that is on
 * show. Any other URL falls through to the not-found page.
 */
export const legalDocumentGuard: CanMatchFn = (_route, segments) => {
  const [, jurisdiction, kind] = segments.map(({ path }) => path);

  return (
    isLegalJurisdiction(jurisdiction) &&
    isLegalDocumentKind(kind) &&
    inject(LegalJurisdictionService).isVisible(jurisdiction, kind)
  );
};
