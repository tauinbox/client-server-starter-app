export const MAIL_QUEUE = 'mail';

export const MAIL_SEND_JOB = 'send';

/**
 * Payload enqueued for delivery. The message is fully rendered before being
 * queued so the worker stays a thin transport — it never re-derives locale or
 * content, and the Redis payload is self-contained.
 */
export interface MailJobData {
  to: string;
  subject: string;
  html: string;
}
