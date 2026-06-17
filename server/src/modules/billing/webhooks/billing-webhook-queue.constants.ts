import type { NormalizedEvent } from '../providers/payment-provider.interface';

export const BILLING_WEBHOOK_QUEUE = 'billing-webhook';

export const BILLING_WEBHOOK_REDUCE_JOB = 'reduce';

/** Name of the periodic job that replays webhook deliveries stuck in `received`. */
export const BILLING_WEBHOOK_RECONCILE_JOB = 'reconcile';

/** Stable scheduler id so multi-instance upserts converge on one schedule. */
export const BILLING_WEBHOOK_RECONCILE_SCHEDULER_ID =
  'billing-webhook-reconcile';

/** How often the sweep looks for stuck `received` deliveries to replay. */
export const WEBHOOK_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * A delivery is only treated as stuck once it has been `received` longer than
 * this — comfortably past the queued reduce job's 5-attempt exponential backoff
 * window (≈ 2.5 min), so the sweep never races an in-flight retry.
 */
export const WEBHOOK_RECEIVED_STUCK_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * After this many failed reconciliation-sweep replays a delivery is moved to
 * `dead_letter` so it stops being retried (and logged) every tick. The event is
 * never dropped — the row keeps its `payload` and stays replayable via the admin
 * endpoint or a provider redelivery, which both reset the counter.
 */
export const WEBHOOK_MAX_REPLAY_ATTEMPTS = 5;

/**
 * Enqueued after a webhook is verified and its idempotency row is inserted.
 * Carries the persisted ledger row id (to mark it processed) and the
 * provider-agnostic event the reducer applies to Subscription/Invoice.
 */
export interface BillingWebhookJobData {
  webhookEventId: string;
  event: NormalizedEvent;
}
