import type { NormalizedEvent } from '../providers/payment-provider.interface';

export const BILLING_WEBHOOK_QUEUE = 'billing-webhook';

export const BILLING_WEBHOOK_REDUCE_JOB = 'reduce';

/**
 * Enqueued after a webhook is verified and its idempotency row is inserted.
 * Carries the persisted ledger row id (to mark it processed) and the
 * provider-agnostic event the reducer applies to Subscription/Invoice (M1).
 */
export interface BillingWebhookJobData {
  webhookEventId: string;
  event: NormalizedEvent;
}
