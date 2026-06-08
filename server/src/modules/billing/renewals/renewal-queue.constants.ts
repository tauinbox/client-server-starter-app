export const BILLING_RENEWAL_QUEUE = 'billing-renewal';

/** Name of the periodic job that scans for and processes due renewals. */
export const BILLING_RENEWAL_SCAN_JOB = 'scan';

/** Stable scheduler id so multi-instance upserts converge on one schedule. */
export const BILLING_RENEWAL_SCHEDULER_ID = 'billing-renewal-scan';

/** How often the scheduler scans for due self-managed subscriptions. */
export const RENEWAL_SCAN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Dunning policy (design §1): a failed self-managed charge moves the
 * subscription to `past_due`; the scheduler retries up to this many times,
 * spaced `DUNNING_RETRY_DELAY_MS` apart (≈ a 7-day grace window), then cancels.
 * Entitlements are kept through the grace window and drop only on cancellation.
 */
export const DUNNING_MAX_ATTEMPTS = 3;

export const DUNNING_RETRY_DELAY_MS = 3 * 24 * 60 * 60 * 1000;
