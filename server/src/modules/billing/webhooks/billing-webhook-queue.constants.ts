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

/** Name of the periodic job that prunes the settled part of the ledger. */
export const BILLING_WEBHOOK_RETENTION_JOB = 'retention';

/** Stable scheduler id so multi-instance upserts converge on one schedule. */
export const BILLING_WEBHOOK_RETENTION_SCHEDULER_ID =
  'billing-webhook-retention';

/**
 * How often the retention sweep runs. Daily is enough for windows measured in
 * days, and keeps the delete load off the reconciliation tick.
 */
export const WEBHOOK_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Age at which a settled (`processed`) delivery is removed from the ledger.
 * Long enough to answer "did we get that event?" for a full billing cycle plus
 * a dispute window.
 */
export const DEFAULT_WEBHOOK_RETENTION_DAYS = 90;

/**
 * Age at which a settled delivery's `payload` is nulled out, ahead of the row
 * itself. The payload only exists so the reconciliation sweep can replay an
 * unfinished delivery; once a row is `processed` it is never replayed, so it is
 * kept for this much longer purely as a triage aid.
 */
export const DEFAULT_WEBHOOK_PAYLOAD_RETENTION_DAYS = 7;

/**
 * Rows touched per statement by the retention sweep. Bounds the transaction (and
 * the lock footprint) on the first sweep of a ledger that has never been pruned.
 */
export const WEBHOOK_RETENTION_BATCH_SIZE = 1000;

/**
 * Ceiling on rows deleted (and on rows redacted) per sweep, so a huge backlog is
 * worked off over several days instead of in one long-running statement.
 */
export const WEBHOOK_RETENTION_MAX_ROWS_PER_SWEEP = 50_000;

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
