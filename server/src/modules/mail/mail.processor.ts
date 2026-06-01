import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost
} from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { MailService } from './mail.service';
import { MAIL_QUEUE, MailJobData } from './mail-queue.constants';
import {
  MAIL_QUEUE_REF,
  type MailQueueRef
} from '../core/metrics/metrics.module';
import { MetricsService } from '../core/metrics/metrics.service';

/**
 * Delivers queued emails. Errors propagate so BullMQ applies the configured
 * retry/backoff; only registered when REDIS_URL is set (see MailModule), which
 * makes it the right place to wire the queue-depth gauge — the gauge stays a
 * no-op whenever no queue exists.
 */
@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    private readonly mailService: MailService,
    @InjectQueue(MAIL_QUEUE) private readonly queue: Queue<MailJobData>,
    @Inject(MAIL_QUEUE_REF) private readonly mailQueueRef: MailQueueRef,
    private readonly metrics: MetricsService
  ) {
    super();
    this.mailQueueRef.getJobCounts = () =>
      this.queue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed'
      );
  }

  async process(job: Job<MailJobData>): Promise<void> {
    await this.mailService.deliver(job.data);
  }

  @OnWorkerEvent('completed')
  onCompleted(): void {
    this.metrics.recordMailJob('completed');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<MailJobData>, err: Error): void {
    this.metrics.recordMailJob('failed');
    this.logger.error(
      `Mail job ${job.id} to ${job.data.to} failed (attempt ${job.attemptsMade})`,
      err
    );
  }
}
