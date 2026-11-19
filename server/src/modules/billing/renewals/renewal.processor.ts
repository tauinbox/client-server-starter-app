import { InjectQueue, OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { LoggedWorkerHost } from '../../../common/utils/logged-worker-host';
import { RenewalService } from './renewal.service';
import { RenewalNoticeService } from './renewal-notice.service';
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
  extends LoggedWorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(RenewalProcessor.name);

  constructor(
    private readonly renewals: RenewalService,
    private readonly renewalNotices: RenewalNoticeService,
    @InjectQueue(BILLING_RENEWAL_QUEUE) private readonly queue: Queue
  ) {
    super();
  }

  /**
   * A failed upsert is logged and the boot goes on: a full Redis refuses the
   * write, and a throw here would stop the API and restart it in a loop. The
   * schedule already in Redis keeps running, and the next boot upserts again.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        BILLING_RENEWAL_SCHEDULER_ID,
        { every: RENEWAL_SCAN_INTERVAL_MS },
        { name: BILLING_RENEWAL_SCAN_JOB, data: {} }
      );
    } catch (error: unknown) {
      this.logger.error('Cannot register the renewal scan schedule', error);
    }
  }

  /** The charges first, so that a notice never names a boundary that passed. */
  async process(): Promise<void> {
    await this.renewals.runDueRenewals();
    await this.renewalNotices.sendRenewalNotices();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(`Renewal scan job ${job.id} failed`, err);
  }
}
