import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailService } from './mail.service';
import { MAIL_QUEUE, MailJobData } from './mail-queue.constants';

/**
 * Delivers queued emails. Errors propagate so BullMQ applies the configured
 * retry/backoff; only registered when REDIS_URL is set (see MailModule).
 */
@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<MailJobData>): Promise<void> {
    await this.mailService.deliver(job.data);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<MailJobData>, err: Error): void {
    this.logger.error(
      `Mail job ${job.id} to ${job.data.to} failed (attempt ${job.attemptsMade})`,
      err
    );
  }
}
