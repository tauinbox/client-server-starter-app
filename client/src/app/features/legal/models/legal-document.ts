import type {
  LegalDocumentKind,
  LegalJurisdiction,
  SupportedLocale
} from '@app/shared/constants';

export type LegalDocumentSection = {
  readonly heading: string;
  readonly paragraphs: readonly string[];
};

/** The content of one file in `assets/legal/<jurisdiction>/`. */
export type LegalDocumentContent = {
  readonly title: string;
  readonly updatedAt: string;
  readonly sections: readonly LegalDocumentSection[];
};

export type LegalDocumentRef = {
  readonly jurisdiction: LegalJurisdiction;
  readonly kind: LegalDocumentKind;
  readonly locale: SupportedLocale;
};
