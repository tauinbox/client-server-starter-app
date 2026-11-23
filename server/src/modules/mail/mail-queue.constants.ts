export const MAIL_QUEUE = 'mail';

export const MAIL_SEND_JOB = 'send';

/**
 * The format of `MailJobData` that this build writes and reads. A change of
 * the job shape increases it, and keeps the reader of the old format for one
 * release.
 */
export const MAIL_JOB_FORMAT = 1;

/**
 * Payload enqueued for delivery. The message is fully rendered before being
 * queued so the worker stays a thin transport — it never re-derives locale or
 * content, and the Redis payload is self-contained.
 */
export interface MailJobData {
  format: number;
  to: string;
  subject: string;
  html: string;
}
