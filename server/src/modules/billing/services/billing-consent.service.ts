import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ErrorKeys,
  LEGAL_DOCUMENTS,
  legalJurisdictionForProvider,
  publishedLegalVersion
} from '@app/shared/constants';
import type { BillingProviderId } from '@app/shared/types';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { ApiError } from '../../../common/errors/api-error';
import { AuditService } from '../../audit/audit.service';
import type { AuditContext } from '../../audit/audit.service';
import { BillingConsent } from '../entities/billing-consent.entity';

/** The legal document versions in force. Tests replace it. */
export const LEGAL_DOCUMENT_VERSIONS = Symbol('LEGAL_DOCUMENT_VERSIONS');

export type LegalDocumentVersions = typeof LEGAL_DOCUMENTS;

/**
 * The terms version that a buyer sent, and the fields of the audit row. An
 * absent version is refused while the terms are published.
 */
export type TermsAcceptance = {
  acceptedVersion?: string;
  actorEmail?: string | null;
  context?: AuditContext;
};

/** The checked acceptance; `record` writes it. Null when no terms apply. */
export type CheckedTermsAcceptance =
  | (Omit<TermsAcceptance, 'acceptedVersion'> & {
      provider: BillingProviderId;
      version: string;
    })
  | null;

function termsNotAccepted(): ApiError {
  return new ApiError(
    ErrorKeys.BILLING.TERMS_NOT_ACCEPTED,
    'Accept the current terms of service to continue.'
  );
}

/**
 * The consent of a buyer to the terms of the seller. A checkout and a purchase
 * check it before any write and record it just before the provider call, so a
 * refused request leaves no consent row.
 */
@Injectable()
export class BillingConsentService {
  constructor(
    @Inject(LEGAL_DOCUMENT_VERSIONS)
    private readonly documents: LegalDocumentVersions,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService
  ) {}

  /** The terms version that a payment on this provider must accept. */
  requiredTermsVersion(provider: BillingProviderId): string | null {
    return publishedLegalVersion(
      this.documents[legalJurisdictionForProvider(provider)].terms
    );
  }

  /**
   * Refuses a missing or stale version while the terms of the jurisdiction
   * are published; a draft asks for no consent.
   */
  check(
    provider: BillingProviderId,
    acceptance: TermsAcceptance
  ): CheckedTermsAcceptance {
    const version = this.requiredTermsVersion(provider);

    if (version === null) return null;

    if (acceptance.acceptedVersion !== version) throw termsNotAccepted();

    return {
      provider,
      version,
      actorEmail: acceptance.actorEmail,
      context: acceptance.context
    };
  }

  /**
   * Writes the consent row and its audit row in one transaction. A version
   * that the user already accepted writes nothing.
   */
  async record(
    userId: string,
    acceptance: CheckedTermsAcceptance
  ): Promise<void> {
    if (!acceptance) return;

    const jurisdiction = legalJurisdictionForProvider(acceptance.provider);

    await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .insert()
        .into(BillingConsent)
        .values({
          userId,
          kind: 'terms',
          jurisdiction,
          documentVersion: acceptance.version
        })
        .orIgnore()
        .returning(['id'])
        .execute();
      const [inserted] = result.raw as { id: string }[];

      if (!inserted) return;

      await this.auditService.log(
        {
          action: AuditAction.BILLING_TERMS_ACCEPT,
          actorId: userId,
          actorEmail: acceptance.actorEmail,
          targetId: inserted.id,
          targetType: 'BillingConsent',
          details: { jurisdiction, version: acceptance.version },
          context: acceptance.context
        },
        manager
      );
    });
  }
}
