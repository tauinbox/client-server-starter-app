import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost
} from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { RenewalService } from './renewal.service';
import {
  BILLING_RENEWAL_QUEUE,
  BILLING_RENEWAL_SCAN_JOB,
  BILLING_RENEWAL_SCHEDULER_ID,
  RENEWAL_SCAN_INTERVAL_MS
} from './renewal-queue.constants';

/**
 * Periodically sweeps due self-managed subscriptions off the request path.
 * Registered only when REDIS_URL is set and not under test (see
 * BillingModule.forRoot); the repeatable scan is upserted once on bootstrap —
 * `upsertJobScheduler` is keyed by a stable id, so multiple app instances
 * converge on a single schedule and a single worker processes each tick
 * (multi-instance safe).
 */
@Processor(BILLING_RENEWAL_QUEUE)
export class RenewalProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(RenewalProcessor.name);

  constructor(
    private readonly renewals: RenewalService,
    @InjectQueue(BILLING_RENEWAL_QUEUE) private readonly queue: Queue
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      BILLING_RENEWAL_SCHEDULER_ID,
      { every: RENEWAL_SCAN_INTERVAL_MS },
      { name: BILLING_RENEWAL_SCAN_JOB, data: {} }
    );
  }

  async process(): Promise<void> {
    await this.renewals.runDueRenewals();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(`Renewal scan job ${job.id} failed`, err);
  }
}
