import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  ErrorKeys,
  LEGAL_DOCUMENTS,
  legalJurisdictionForProvider,
  publishedLegalVersion
} from '@app/shared/constants';
import type { BillingProviderId } from '@app/shared/types';
import { getState, logAudit } from '../state';
import type { AuthenticatedRequest } from '../types';
import { sendError } from './error-envelope.helpers';

/** Mirrors `BillingConsentService.requiredTermsVersion`. */
export function requiredTermsVersion(
  provider: BillingProviderId
): string | null {
  const jurisdiction = legalJurisdictionForProvider(provider);
  const terms =
    getState().legalTermsOverrides[jurisdiction] ??
    LEGAL_DOCUMENTS[jurisdiction].terms;

  return publishedLegalVersion(terms);
}

/**
 * Mirrors `BillingConsentService.check`: the version to record, null when the
 * terms are a draft, or false after the refusal was sent.
 */
export function checkTerms(
  res: Response,
  provider: BillingProviderId,
  acceptedVersion: unknown
): string | null | false {
  const version = requiredTermsVersion(provider);

  if (version === null) return null;

  if (acceptedVersion !== version) {
    sendError(
      res,
      ErrorKeys.BILLING.TERMS_NOT_ACCEPTED,
      'Accept the current terms of service to continue.'
    );

    return false;
  }

  return version;
}

/**
 * Mirrors `BillingConsentService.record`: one row and one audit row for each
 * accepted version of a user.
 */
export function recordTerms(
  req: Request,
  provider: BillingProviderId,
  version: string | null
): void {
  if (version === null) return;

  const { user } = req as AuthenticatedRequest;
  const state = getState();
  const jurisdiction = legalJurisdictionForProvider(provider);
  const known = state.billingConsents.some(
    (consent) =>
      consent.userId === user.id &&
      consent.kind === 'terms' &&
      consent.jurisdiction === jurisdiction &&
      consent.documentVersion === version
  );

  if (known) return;

  const consent = {
    id: randomUUID(),
    userId: user.id,
    kind: 'terms' as const,
    jurisdiction,
    documentVersion: version,
    acceptedAt: new Date().toISOString()
  };

  state.billingConsents.push(consent);
  logAudit('BILLING_TERMS_ACCEPT', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: consent.id,
    targetType: 'BillingConsent',
    details: { jurisdiction, version },
    ip: req.ip
  });
}
