import type { BillingProviderId } from '../types/billing.types';

export const LEGAL_JURISDICTIONS = ['ru', 'intl'] as const;

export type LegalJurisdiction = (typeof LEGAL_JURISDICTIONS)[number];

export const LEGAL_DOCUMENT_KINDS = [
  'terms',
  'privacy',
  'refund',
  'contacts'
] as const;

export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

export const LEGAL_DOCUMENT_STATUSES = ['draft', 'published'] as const;

export type LegalDocumentStatus = (typeof LEGAL_DOCUMENT_STATUSES)[number];

export type LegalDocumentVersion = {
  /** The date of the text, also the `updatedAt` of each locale file. */
  readonly version: string;
  /** A draft waits for the legal review and the details of the seller. */
  readonly status: LegalDocumentStatus;
};

/**
 * The current version of each legal document. The client shows this version
 * and the server compares an accepted version with it.
 */
export const LEGAL_DOCUMENTS: Record<
  LegalJurisdiction,
  Record<LegalDocumentKind, LegalDocumentVersion>
> = {
  ru: {
    terms: { version: '2026-11-14', status: 'draft' },
    privacy: { version: '2026-11-14', status: 'draft' },
    refund: { version: '2026-11-14', status: 'draft' },
    contacts: { version: '2026-11-14', status: 'draft' }
  },
  intl: {
    terms: { version: '2026-11-14', status: 'draft' },
    privacy: { version: '2026-11-14', status: 'draft' },
    refund: { version: '2026-11-14', status: 'draft' },
    contacts: { version: '2026-11-14', status: 'draft' }
  }
};

export function isLegalJurisdiction(
  value: unknown
): value is LegalJurisdiction {
  return (LEGAL_JURISDICTIONS as readonly unknown[]).includes(value);
}

export function isLegalDocumentKind(
  value: unknown
): value is LegalDocumentKind {
  return (LEGAL_DOCUMENT_KINDS as readonly unknown[]).includes(value);
}

/** The seller documents follow the payment provider of the billing region. */
export function legalJurisdictionForProvider(
  provider: BillingProviderId
): LegalJurisdiction {
  return provider === 'yookassa' ? 'ru' : 'intl';
}
