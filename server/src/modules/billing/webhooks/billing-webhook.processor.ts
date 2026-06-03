import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WebhookIngestionService } from './webhook-ingestion.service';
import {
  BILLING_WEBHOOK_QUEUE,
  type BillingWebhookJobData
} from './billing-webhook-queue.constants';

/**
 * Reduces verified billing webhooks off the request path. Errors propagate so
 * BullMQ applies the configured retry/backoff. Only registered when REDIS_URL
 * is set (see BillingModule.forRoot); without Redis, ingestion reduces inline.
 */
@Processor(BILLING_WEBHOOK_QUEUE)
export class BillingWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(BillingWebhookProcessor.name);

  constructor(private readonly ingestion: WebhookIngestionService) {
    super();
  }

  async process(job: Job<BillingWebhookJobData>): Promise<void> {
    await this.ingestion.processEvent(job.data);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<BillingWebhookJobData>, err: Error): void {
    this.logger.error(
      `Billing webhook job ${job.id} (event ${job.data.webhookEventId}) failed (attempt ${job.attemptsMade})`,
      err
    );
  }
}
