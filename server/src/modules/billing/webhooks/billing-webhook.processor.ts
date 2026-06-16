import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost
} from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { WebhookIngestionService } from './webhook-ingestion.service';
import { WebhookReconciliationService } from './webhook-reconciliation.service';
import {
  BILLING_WEBHOOK_QUEUE,
  BILLING_WEBHOOK_RECONCILE_JOB,
  BILLING_WEBHOOK_RECONCILE_SCHEDULER_ID,
  WEBHOOK_RECONCILE_INTERVAL_MS,
  type BillingWebhookJobData
} from './billing-webhook-queue.constants';

/**
 * Reduces verified billing webhooks off the request path. Errors propagate so
 * BullMQ applies the configured retry/backoff. Only registered when REDIS_URL
 * is set (see BillingModule.forRoot); without Redis, ingestion reduces inline.
 *
 * Also hosts the periodic reconciliation sweep that replays deliveries stuck in
 * `received` (a queued reduce that exhausted its retries). The repeatable job is
 * upserted once on bootstrap under a stable id, so multiple instances converge
 * on a single schedule.
 */
@Processor(BILLING_WEBHOOK_QUEUE)
export class BillingWebhookProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(BillingWebhookProcessor.name);

  constructor(
    private readonly ingestion: WebhookIngestionService,
    private readonly reconciliation: WebhookReconciliationService,
    @InjectQueue(BILLING_WEBHOOK_QUEUE) private readonly queue: Queue
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    // Skip under Jest: short-lived test apps would pollute Redis with
    // schedulers and race the sweep against DataSource teardown (mirrors the
    // renewal scheduler). Reconciliation only matters in queued mode anyway.
    if (process.env['NODE_ENV'] === 'test') {
      return;
    }
    await this.queue.upsertJobScheduler(
      BILLING_WEBHOOK_RECONCILE_SCHEDULER_ID,
      { every: WEBHOOK_RECONCILE_INTERVAL_MS },
      { name: BILLING_WEBHOOK_RECONCILE_JOB, data: {} }
    );
  }

  async process(job: Job<BillingWebhookJobData>): Promise<void> {
    if (job.name === BILLING_WEBHOOK_RECONCILE_JOB) {
      await this.reconciliation.sweep();
      return;
    }
    await this.ingestion.processEvent(job.data);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<BillingWebhookJobData>, err: Error): void {
    this.logger.error(
      `Billing webhook job ${job.id} (${job.name}) failed (attempt ${job.attemptsMade})`,
      err
    );
  }
}
